import type { GpuAdapter, ProcessRow, Snapshot, Workload } from '@shared/types'

export function processRow(partial: Partial<ProcessRow> & { pid: number; name: string }): ProcessRow {
  return {
    ppid: null,
    path: null,
    cpuPct: 0,
    cpuTimeSec: 0,
    rssBytes: 0,
    privateBytes: 0,
    vramMiB: 0,
    sharedVramMiB: 0,
    gpuUtilPct: null,
    gpuAdapters: [],
    threads: 1,
    startedAt: null,
    isProtected: false,
    isSelf: false,
    workloadId: null,
    ...partial
  }
}

export function gpuAdapter(partial: Partial<GpuAdapter> & { id: string; name: string }): GpuAdapter {
  return {
    luid: '0x00000000:0x0000CE41',
    vendor: 'nvidia',
    kind: 'discrete',
    driver: '1.0',
    telemetry: 'nvidia-smi',
    vramTotalMiB: 16000,
    vramUsedMiB: 1000,
    vramFreeMiB: 15000,
    sharedUsedMiB: 0,
    utilPct: 10,
    utilByEngine: {},
    memUtilPct: 6,
    tempC: 40,
    powerW: 20,
    powerLimitW: 180,
    clockSmMhz: 1000,
    clockMemMhz: 7000,
    fanPct: 0,
    processes: [],
    ...partial
  }
}

export function workload(partial: Partial<Workload> & { id: string }): Workload {
  return {
    label: 'ComfyUI',
    kind: 'ai',
    rootPid: 100,
    pids: [100],
    processCount: 1,
    ports: [],
    cpuPct: 0,
    rssBytes: 0,
    privateBytes: 0,
    vramMiB: 0,
    sharedVramMiB: 0,
    gpuUtilPct: 0,
    adapters: [],
    startedAt: null,
    isProtected: false,
    isSelf: false,
    ...partial
  }
}

export function snapshot(partial: Partial<Snapshot> = {}): Snapshot {
  return {
    schema: 2,
    ts: Date.now(),
    seq: 1,
    host: {
      hostname: 'test',
      platform: 'win32',
      release: '10.0',
      arch: 'x64',
      uptimeSec: 100,
      appUptimeSec: 10,
      elevated: false,
      cpuModel: 'Test CPU',
      cores: 8,
      threads: 16
    },
    cpu: { usagePct: 10, perCorePct: [], loadAvg: null, speedMhz: null },
    memory: {
      totalBytes: 32 * 1024 ** 3,
      usedBytes: 8 * 1024 ** 3,
      availableBytes: 24 * 1024 ** 3,
      usagePct: 25,
      committedBytes: 10 * 1024 ** 3,
      commitLimitBytes: 40 * 1024 ** 3,
      commitPct: 25,
      cacheBytes: null
    },
    gpus: [],
    primaryGpuId: null,
    processes: [],
    workloads: [],
    volumes: [],
    history: { intervalMs: 1500, cpu: [], gpu: [], vramMiB: [], ram: [], commit: [] },
    health: { status: 'ok', reasons: [] },
    sources: {
      nvidia: { status: 'live', lastUpdate: 1, latencyMs: 10, error: null, detail: null },
      windowsSensor: { status: 'live', lastUpdate: 1, latencyMs: 10, error: null, detail: null },
      storage: { status: 'live', lastUpdate: 1, latencyMs: 10, error: null, detail: null },
      ports: { status: 'live', lastUpdate: 1, latencyMs: 10, error: null, detail: null }
    },
    ...partial
  }
}
