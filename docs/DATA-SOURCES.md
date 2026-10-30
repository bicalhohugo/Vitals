# Fontes de dados

Cada número do HUD vem de um lugar específico. Este documento diz de onde,
com que frequência, e onde a fonte mente.

## Resumo

| Fonte | Arquivo | Entrega | Frequência |
| --- | --- | --- | --- |
| Sensor PowerShell | `sources/windows-sensor.ps1` + `.ts` | processos, ppid, commit, GPU/VRAM por processo e adaptador, núcleos | `VITALS_SAMPLE_MS` |
| `nvidia-smi` | `sources/nvidia.ts` | temperatura, potência, clocks, fan, VRAM total/uso, driver | `VITALS_SAMPLE_MS` |
| `netstat` | `sources/ports.ts` | porta TCP em LISTENING → pid | `VITALS_PORTS_MS` |
| Volumes | `sources/storage.ts` | espaço por volume | ~30 s |
| Node `os` | `engine.ts` | fallback de CPU, hostname, uptime | tick |

## Sensor PowerShell

### Protocolo

Uma linha JSON por evento no stdout:

```json
{"type":"hello","pid":1234,"intervalMs":1500,"gpuCounters":445,"vramCounters":38,"memCounters":3,"cpuName":"AMD Ryzen 7 5700G...","cores":8,"threads":16,"native":true,"adapters":[...],"errors":[]}
{"type":"tick","t":1793340153142,"seq":1,"sampleMs":436,"procs":[...],"gpu":[...],"vram":[...],"adapters":[...],"mem":{...},"errors":[]}
```

- `seq` só cresce; o motor usa isso para saber se há amostra nova.
- `errors` traz falhas parciais (categoria de contador ausente, processo
  ilegível) sem derrubar o sensor.
- `-ParentPid <pid>` faz o sensor sair quando o Vitals morrer.
- Watchdog interno reinicia contadores que travarem; `restarts` aparece em
  `sources.windowsSensor.detail`.

### Processos

`GetProcesses()` + `Process`:

- `ws` = `WorkingSet64` (RSS);
- `priv` = `PrivateMemorySize64` (commit privado);
- `cpu` = `TotalProcessorTime.TotalSeconds` (acumulado, não percentual);
- `start` = `StartTime` em ms epoch;
- `ppid` = P/Invoke `NtQueryInformationProcess` com
  `PROCESS_QUERY_LIMITED_INFORMATION`.

O percentual por processo é calculado **no TypeScript**:

```
cpuPct = (cpuAgora - cpuAnterior) / (agora - antes) / logicalCpus * 100
```

Por isso o primeiro tick tem `cpuPct = null` e o motor só recalcula quando o
sensor publica um `seq` novo.

### GPU por processo

Categorias de contador (nomes em inglês):

| Categoria | Counter | Instância contém |
| --- | --- | --- |
| `GPU Engine` | `Utilization Percentage` | `pid_1234_luid_0x..._0x..._phys_0_eng_0_engtype_3D` |
| `GPU Process Memory` | `Dedicated Usage` | `pid_1234_luid_0x..._0x...` |
| `GPU Process Memory` | `Shared Usage` | idem |
| `GPU Adapter Memory` | `Dedicated Usage` / `Shared Usage` | `luid_0x..._0x...` |

O parser extrai `pid` e `luid` por regex. O engine sai de `engtype_` e é
normalizado (`HighPriorityCompute` → `Compute`). A utilização do processo é o
**maior** engine, como no Gerenciador de Tarefas.

### Adaptadores (DXGI)

Bloco C# compilado com `Add-Type`:

- `CreateDXGIFactory1(IID_IDXGIFactory1)`;
- `EnumAdapters1` até `DXGI_ERROR_NOT_FOUND`;
- `GetDesc1` → `Description`, `VendorId`, `DedicatedVideoMemory`,
  `SharedSystemMemory`;
- devolve linhas `luid|nome|vendorId|dedicada|compartilhada`.

LUID é formatado `0xHIGH:0xLOW` com 8 dígitos. É a chave de junção com os
contadores.

`Get-Kind`:

- vendor `0x1414` (Microsoft) → `software`;
- AMD com dedicada < 64 MB → `integrated`;
- Intel com dedicada < 256 MB → `integrated`;
- resto → `discrete`.

> Limitação conhecida: a iGPU AMD reserva vários GB de "dedicated", então
> aparece como `discrete`. É cosmético; a atribuição por LUID continua certa.

### Memória

`Memory\Committed Bytes`, `Commit Limit`, `Cache Bytes` via
`PerformanceCounter`. Se a categoria `Memory` não existir, `commitPct = null`
e a saúde ignora o sinal.

Commit charge é o número que importa no Windows: quando ele chega perto do
limite, alocações falham e processos morrem — antes de a RAM física zerar.

### Núcleos

`Win32_Processor.NumberOfCores` e `NumberOfLogicalProcessors`. Se falhar,
`cores = 0` e o motor cai para `os.cpus().length` (mostrando `16C/16T` numa
máquina 8C/16T). Se o header mostrar isso, o `hello` não chegou.

## nvidia-smi

Executado a cada tick:

```
nvidia-smi --query-gpu=name,utilization.gpu,memory.total,memory.used,temperature.gpu,power.draw,power.limit,clocks.sm,clocks.mem,fan.speed,driver_version --format=csv,noheader,nounits
```

- Não expõe LUID. O merge com o adaptador DXGI é por **nome normalizado**
  (`normalizeGpuName`: minúsculas, remove marca/sufixos comuns).
- Fornece o total de VRAM "real" (16311 MiB, não o arredondado do DXGI).
- Se falhar, a GPU ainda aparece via contadores, com `telemetry:
  'windows-counters'` e sem temperatura/potência.

## Portas (netstat)

`netstat -ano -p tcp` → linhas `TCP 0.0.0.0:8188 0.0.0.0:0 LISTENING 13740`.

`parseNetstat` guarda apenas LISTENING e monta `pid → portas`. O engine anexa
ao workload do pid. Portas não são tentadas de novo a cada tick de 1,5 s: o
timer é separado (`VITALS_PORTS_MS`, padrão 10 s).

## Volumes

`Get-CimInstance Win32_LogicalDisk` (fallback Node) → total/livre/uso por
mount. Aparece no rail; não entra na saúde.

## Armadilhas

| Sintoma | Causa | O que fazer |
| --- | --- | --- |
| `0 adaptador(es)` e `cores=0` | `hello` falhou (ver WORKLOG 2026-10-30) | use `.ToArray()`, não `@($list)`, no `[ordered]@{}` |
| `ppid = -1` em massa | processo protegido/saindo | normal; vira workload próprio |
| CPU% sempre 0 | sensor sem `seq` novo ou delta sobre a mesma amostra | motor já protege; não remova o guard |
| RSS minúsculo com RAM cheia | memória paginada/trimmed | use `privateBytes` |
| Contadores de GPU ausentes | nome de categoria localizado (Windows pt-BR) | confira `Get-Counter -ListSet *`; ajuste o nome no `.ps1` |
| Vários `svchost` como workload | `ppid=-1` + nome de serviço | `SYSTEM_HOST_NAMES` já exclui; se aparecer, ajuste a lista |
| WARP como GPU | adaptador software | UI esconde quando ocioso |
