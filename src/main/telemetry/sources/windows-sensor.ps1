# Vitals - sensor Windows
#
# Processo persistente que le processos, VRAM/utilizacao de GPU por processo e
# por adaptador, e escreve uma linha JSON (NDJSON) por amostra em stdout.
#
# Por que um processo persistente: enumerar os contadores "GPU Engine" custa
# ~1.4s por chamada quando feito via Get-Counter/CIM. Mantendo os handles de
# PerformanceCounter abertos, cada amostra cai para ~200ms.
#
# Contrato de saida: docs/DATA-SOURCES.md. Este arquivo e embutido no bundle
# via import "?raw"; nao renomeie.
#
# Identidade de GPU: cada adaptador tem um LUID (Local Unique Identifier) do
# DXGI. Os contadores do Windows usam esse LUID nos nomes das instancias, entao
# ele e a chave para separar NVIDIA / iGPU / WARP sem heuristica.

param(
  [int]$IntervalMs = 1500,
  [int]$ParentPid = 0
)

$ErrorActionPreference = 'Continue'

try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch {
  # Console legado: segue com o encoding padrao.
}

$script:errors = New-Object System.Collections.Generic.List[string]

function Add-SensorError {
  param([string]$Message)
  if ($script:errors.Count -lt 25) { $script:errors.Add($Message) }
}

# --- Helpers nativos ---------------------------------------------------------
# DXGI: enumera adaptadores com LUID + nome + memoria.
# NtQueryInformationProcess: PPID sem o custo de WMI (~200ms por tick).
$nativeReady = $false
try {
  $nativeSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class VitalsNative {
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct DESC1 {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    public uint VendorId, DeviceId, SubSysId, Revision;
    public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
    public LUID AdapterLuid; public uint Flags;
  }
  [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Factory1 {
    [PreserveSig] int SetPrivateData(ref Guid g, uint s, IntPtr d);
    [PreserveSig] int SetPrivateDataInterface(ref Guid g, IntPtr d);
    [PreserveSig] int GetPrivateData(ref Guid g, out IntPtr d);
    [PreserveSig] int GetParent(ref Guid g, out IntPtr p);
    [PreserveSig] int EnumAdapters(uint i, out IntPtr a);
    [PreserveSig] int MakeWindowAssociation(IntPtr w, uint f);
    [PreserveSig] int GetWindowAssociation(out IntPtr w);
    [PreserveSig] int CreateSwapChain(IntPtr d, IntPtr desc, out IntPtr sc);
    [PreserveSig] int CreateSoftwareAdapter(IntPtr m, out IntPtr a);
    [PreserveSig] int EnumAdapters1(uint i, out Adapter1 a);
    [PreserveSig] int IsCurrent();
  }
  [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Adapter1 {
    [PreserveSig] int SetPrivateData(ref Guid g, uint s, IntPtr d);
    [PreserveSig] int SetPrivateDataInterface(ref Guid g, IntPtr d);
    [PreserveSig] int GetPrivateData(ref Guid g, out IntPtr d);
    [PreserveSig] int GetParent(ref Guid g, out IntPtr p);
    [PreserveSig] int EnumOutputs(uint i, out IntPtr o);
    [PreserveSig] int GetDesc(IntPtr d);
    [PreserveSig] int CheckInterfaceSupport(ref Guid g, out long u);
    [PreserveSig] int GetDesc1(out DESC1 d);
  }
  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr ppFactory);

  /** "0xHIGH8:0xLOW8" - mesmo formato das instancias dos contadores. */
  public static string FormatLuid(uint low, int high) {
    return String.Format("0x{0:X8}:0x{1:X8}", unchecked((uint)high), low);
  }

  public static string[] Adapters() {
    var res = new List<string>();
    Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
    IntPtr p;
    if (CreateDXGIFactory1(ref iid, out p) != 0) return new string[0];
    var f = (Factory1)Marshal.GetObjectForIUnknown(p);
    for (uint i = 0; i < 16; i++) {
      Adapter1 a;
      if (f.EnumAdapters1(i, out a) != 0) break;
      DESC1 d;
      if (a.GetDesc1(out d) != 0) continue;
      res.Add(String.Format("{0}|{1}|{2}|{3}|{4}",
        FormatLuid(d.AdapterLuid.Low, d.AdapterLuid.High),
        d.Description.Replace("|", " "),
        d.VendorId,
        ((ulong)d.DedicatedVideoMemory).ToString(),
        ((ulong)d.SharedSystemMemory).ToString()));
    }
    return res.ToArray();
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_BASIC_INFORMATION {
    public IntPtr Reserved1;
    public IntPtr PebBaseAddress;
    public IntPtr Reserved2_0;
    public IntPtr Reserved2_1;
    public IntPtr UniqueProcessId;
    public IntPtr InheritedFromUniqueProcessId;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")]
  static extern int NtQueryInformationProcess(IntPtr handle, int infoClass, ref PROCESS_BASIC_INFORMATION info, int length, out int returned);

  public static int ParentPid(uint pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return -1;
    try {
      var info = new PROCESS_BASIC_INFORMATION();
      int returned;
      int status = NtQueryInformationProcess(h, 0, ref info, Marshal.SizeOf(info), out returned);
      if (status != 0) return -1;
      return (int)info.InheritedFromUniqueProcessId.ToInt64();
    } finally {
      CloseHandle(h);
    }
  }
}
'@
  Add-Type -TypeDefinition $nativeSource -ErrorAction Stop
  $nativeReady = $true
} catch {
  Add-SensorError "Add-Type nativo falhou: $($_.Exception.Message)"
}

function Get-LuidFromInstance {
  param([string]$Instance)
  $m = [regex]::Match($Instance, 'luid_0x([0-9A-Fa-f]+)_0x([0-9A-Fa-f]+)')
  if (-not $m.Success) { return $null }
  return '0x{0}:0x{1}' -f $m.Groups[1].Value.ToUpper().PadLeft(8, '0'), $m.Groups[2].Value.ToUpper().PadLeft(8, '0')
}

function Get-PidFromInstance {
  param([string]$Instance)
  $m = [regex]::Match($Instance, 'pid_(\d+)')
  if ($m.Success) { return [int]$m.Groups[1].Value }
  return -1
}

function New-CounterMap {
  param(
    [string]$Category,
    [string]$Counter,
    [string]$Include = ''
  )
  $map = @{}
  try {
    $categoryObject = [System.Diagnostics.PerformanceCounterCategory]::new($Category)
    foreach ($instance in $categoryObject.GetInstanceNames()) {
      if ($Include -and $instance -notmatch $Include) { continue }
      try {
        $map[$instance] = [System.Diagnostics.PerformanceCounter]::new($Category, $Counter, $instance, $true)
      } catch {
        Add-SensorError "counter $Category/$Counter/$instance"
      }
    }
  } catch {
    Add-SensorError "categoria $Category indisponivel"
  }
  return $map
}

function Get-Vendor {
  param([uint32]$VendorId)
  switch ($VendorId) {
    0x10DE { return 'nvidia' }
    0x1002 { return 'amd' }
    0x8086 { return 'intel' }
    0x1414 { return 'microsoft' }
    default { return 'other' }
  }
}

function Get-Kind {
  param([string]$Vendor, [uint64]$Dedicated, [uint32]$VendorId)
  if ($VendorId -eq 0x1414) { return 'software' }
  if ($Vendor -eq 'amd' -and $Dedicated -lt 64MB) { return 'integrated' }
  if ($Vendor -eq 'intel' -and $Dedicated -lt 256MB) { return 'integrated' }
  return 'discrete'
}

# --- Adaptadores (uma vez) ---------------------------------------------------
$adapters = New-Object System.Collections.Generic.List[object]
if ($nativeReady) {
  foreach ($line in [VitalsNative]::Adapters()) {
    $parts = $line.Split('|')
    if ($parts.Count -lt 5) { continue }
    $vendor = Get-Vendor ([uint32]$parts[2])
    $dedicated = [uint64]$parts[3]
    $adapters.Add([pscustomobject]@{
      luid          = $parts[0]
      name          = $parts[1]
      vendor        = $vendor
      kind          = (Get-Kind -Vendor $vendor -Dedicated $dedicated -VendorId ([uint32]$parts[2]))
      dedicatedBytes = $dedicated
      sharedBytes   = [uint64]$parts[4]
    })
  }
}

$gpuCounters = New-CounterMap -Category 'GPU Engine' -Counter 'Utilization Percentage' -Include 'engtype_'
$vramCounters = New-CounterMap -Category 'GPU Process Memory' -Counter 'Dedicated Usage'
$sharedCounters = New-CounterMap -Category 'GPU Process Memory' -Counter 'Shared Usage'
$adapterDedicated = New-CounterMap -Category 'GPU Adapter Memory' -Counter 'Dedicated Usage'
$adapterShared = New-CounterMap -Category 'GPU Adapter Memory' -Counter 'Shared Usage'

# Adaptadores vistos nos contadores mas ausentes do DXGI (fallback).
if ($adapters.Count -eq 0) {
  foreach ($instance in $adapterDedicated.Keys) {
    $luid = Get-LuidFromInstance -Instance $instance
    if (-not $luid) { continue }
    $adapters.Add([pscustomobject]@{
      luid = $luid; name = "Adaptador $luid"; vendor = 'other'; kind = 'other'
      dedicatedBytes = 0; sharedBytes = 0
    })
  }
}

$memoryCounters = @{}
foreach ($counterName in @('Committed Bytes', 'Commit Limit', 'Cache Bytes')) {
  try {
    $memoryCounters[$counterName] = [System.Diagnostics.PerformanceCounter]::new('Memory', $counterName, $true)
  } catch {
    Add-SensorError "Memory/$counterName"
  }
}

$cpuName = $null
$cpuCores = 0
$cpuThreads = 0
try {
  $cpuInfo = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
  if ($cpuInfo) {
    $cpuName = $cpuInfo.Name
    $cpuCores = [int]$cpuInfo.NumberOfCores
    $cpuThreads = [int]$cpuInfo.NumberOfLogicalProcessors
  }
} catch {
  Add-SensorError 'Win32_Processor indisponivel'
}

$hello = [ordered]@{
  type         = 'hello'
  pid          = $PID
  intervalMs   = $IntervalMs
  gpuCounters  = $gpuCounters.Count
  vramCounters = $vramCounters.Count
  memCounters  = $memoryCounters.Count
  cpuName      = $cpuName
  cores        = $cpuCores
  threads      = $cpuThreads
  native       = $nativeReady
  # @($list) quebra a conversao para OrderedDictionary ("Argument types do
  # not match"); ToArray() e o caminho seguro.
  adapters     = $adapters.ToArray()
  errors       = $script:errors.ToArray()
}
[Console]::Out.WriteLine(($hello | ConvertTo-Json -Compress -Depth 5))
[Console]::Out.Flush()

$seq = 0
$script:errors.Clear()

while ($true) {
  if ($ParentPid -gt 0) {
    $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
    if (-not $parent) { break }
  }

  $startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $script:errors.Clear()

  # --- Processos -----------------------------------------------------------
  $processes = New-Object System.Collections.Generic.List[object]
  foreach ($process in [System.Diagnostics.Process]::GetProcesses()) {
    try {
      if ($process.Id -le 4) { continue }
      $entry = [ordered]@{
        id      = $process.Id
        ppid    = -1
        name    = $process.ProcessName
        ws      = 0L
        priv    = 0L
        cpu     = $null
        threads = 0
        path    = $null
        start   = $null
      }
      if ($nativeReady) {
        try { $entry.ppid = [VitalsNative]::ParentPid([uint32]$process.Id) } catch {}
      }
      try { $entry.ws = $process.WorkingSet64 } catch {}
      try { $entry.priv = $process.PrivateMemorySize64 } catch {}
      try { $entry.cpu = [math]::Round($process.TotalProcessorTime.TotalSeconds, 3) } catch {}
      try { $entry.threads = $process.Threads.Count } catch {}
      try { $entry.path = $process.MainModule.FileName } catch {}
      try { $entry.start = [DateTimeOffset]::new($process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } catch {}
      $processes.Add([pscustomobject]$entry)
    } catch {
      Add-SensorError "processo $($process.Id)"
    } finally {
      try { $process.Dispose() } catch {}
    }
  }

  # --- GPU por processo e por adaptador ------------------------------------
  $gpuByPidLuid = @{}
  $engineTotals = @{}
  foreach ($instance in $gpuCounters.Keys) {
    try {
      $value = [double]$gpuCounters[$instance].NextValue()
    } catch {
      continue
    }
    if ($value -le 0) { continue }

    $processId = Get-PidFromInstance -Instance $instance
    if ($processId -lt 0) { continue }
    $luid = Get-LuidFromInstance -Instance $instance
    if (-not $luid) { $luid = 'unknown' }

    $engineMatch = [regex]::Match($instance, 'engtype_(.+)$')
    if (-not $engineMatch.Success) { continue }
    $engine = $engineMatch.Groups[1].Value
    $engine = ($engine -replace '\s+\d+$', '') -replace '\s+', ''
    if ($engine -eq 'HighPriorityCompute') { $engine = 'Compute' }
    if (-not $engine) { $engine = 'Other' }

    $key = "$processId|$luid"
    if (-not $gpuByPidLuid.ContainsKey($key)) { $gpuByPidLuid[$key] = [ordered]@{} }
    if (-not $gpuByPidLuid[$key].Contains($engine)) { $gpuByPidLuid[$key][$engine] = 0.0 }
    $gpuByPidLuid[$key][$engine] = [math]::Round($gpuByPidLuid[$key][$engine] + $value, 2)

    if (-not $engineTotals.ContainsKey($luid)) { $engineTotals[$luid] = @{} }
    if (-not $engineTotals[$luid].ContainsKey($engine)) { $engineTotals[$luid][$engine] = 0.0 }
    $engineTotals[$luid][$engine] += $value
  }

  $gpuArray = New-Object System.Collections.Generic.List[object]
  foreach ($key in $gpuByPidLuid.Keys) {
    $split = $key.Split('|')
    $engines = $gpuByPidLuid[$key]
    $max = 0.0
    foreach ($value in $engines.Values) {
      if ($value -gt $max) { $max = $value }
    }
    $gpuArray.Add([pscustomobject]@{
      pid     = [int]$split[0]
      luid    = $split[1]
      util    = [math]::Round([math]::Min(100.0, $max), 2)
      engines = $engines
    })
  }

  # --- VRAM por processo e adaptador ---------------------------------------
  $vramByPidLuid = @{}
  foreach ($instance in $vramCounters.Keys) {
    try { $value = [double]$vramCounters[$instance].NextValue() } catch { continue }
    if ($value -le 0) { continue }
    $processId = Get-PidFromInstance -Instance $instance
    if ($processId -lt 0) { continue }
    $luid = Get-LuidFromInstance -Instance $instance
    if (-not $luid) { $luid = 'unknown' }
    $key = "$processId|$luid"
    if (-not $vramByPidLuid.ContainsKey($key)) { $vramByPidLuid[$key] = 0.0 }
    $vramByPidLuid[$key] += $value
  }

  $sharedByPidLuid = @{}
  foreach ($instance in $sharedCounters.Keys) {
    try { $value = [double]$sharedCounters[$instance].NextValue() } catch { continue }
    if ($value -le 0) { continue }
    $processId = Get-PidFromInstance -Instance $instance
    if ($processId -lt 0) { continue }
    $luid = Get-LuidFromInstance -Instance $instance
    if (-not $luid) { $luid = 'unknown' }
    $key = "$processId|$luid"
    if (-not $sharedByPidLuid.ContainsKey($key)) { $sharedByPidLuid[$key] = 0.0 }
    $sharedByPidLuid[$key] += $value
  }

  $vramArray = New-Object System.Collections.Generic.List[object]
  foreach ($key in $vramByPidLuid.Keys) {
    $split = $key.Split('|')
    $shared = 0.0
    if ($sharedByPidLuid.ContainsKey($key)) { $shared = $sharedByPidLuid[$key] }
    $vramArray.Add([pscustomobject]@{
      pid       = [int]$split[0]
      luid      = $split[1]
      dedicated = [long]$vramByPidLuid[$key]
      shared    = [long]$shared
    })
  }

  # --- Memoria dos adaptadores ---------------------------------------------
  $adapterUse = New-Object System.Collections.Generic.List[object]
  foreach ($instance in $adapterDedicated.Keys) {
    $luid = Get-LuidFromInstance -Instance $instance
    if (-not $luid) { continue }
    $dedicated = 0.0
    $shared = 0.0
    try { $dedicated = [double]$adapterDedicated[$instance].NextValue() } catch {}
    if ($adapterShared.ContainsKey($instance)) {
      try { $shared = [double]$adapterShared[$instance].NextValue() } catch {}
    }
    $engines = [ordered]@{}
    if ($engineTotals.ContainsKey($luid)) {
      $max = 0.0
      foreach ($name in $engineTotals[$luid].Keys) {
        $value = [math]::Round([math]::Min(100.0, $engineTotals[$luid][$name]), 2)
        $engines[$name] = $value
        if ($value -gt $max) { $max = $value }
      }
      $util = $max
    } else {
      $util = 0.0
    }
    $adapterUse.Add([pscustomobject]@{
      luid      = $luid
      dedicated = [long]$dedicated
      shared    = [long]$shared
      util      = [math]::Round($util, 2)
      engines   = $engines
    })
  }

  # --- Memoria do sistema (commit) ----------------------------------------
  $memory = [ordered]@{ committed = $null; limit = $null; cache = $null }
  try {
    if ($memoryCounters.ContainsKey('Committed Bytes')) {
      $memory.committed = [long]$memoryCounters['Committed Bytes'].NextValue()
    }
  } catch { Add-SensorError 'Memory/Committed Bytes/read' }
  try {
    if ($memoryCounters.ContainsKey('Commit Limit')) {
      $memory.limit = [long]$memoryCounters['Commit Limit'].NextValue()
    }
  } catch { Add-SensorError 'Memory/Commit Limit/read' }
  try {
    if ($memoryCounters.ContainsKey('Cache Bytes')) {
      $memory.cache = [long]$memoryCounters['Cache Bytes'].NextValue()
    }
  } catch { Add-SensorError 'Memory/Cache Bytes/read' }

  # --- Saida ---------------------------------------------------------------
  $seq++
  $finishedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $payload = [ordered]@{
    type     = 'tick'
    t        = $finishedAt
    seq      = $seq
    sampleMs = $finishedAt - $startedAt
    procs    = $processes
    gpu      = $gpuArray
    vram     = $vramArray
    adapters = $adapterUse
    mem      = $memory
    errors   = $script:errors.ToArray()
  }

  try {
    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
  } catch {
    # Falha de serializacao nao deve derrubar o sensor.
  }

  Start-Sleep -Milliseconds $IntervalMs
}
