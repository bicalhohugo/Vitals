/**
 * Contrato de dados do Vitals.
 *
 * Tudo que atravessa main <-> renderer <-> API HTTP passa por estes tipos.
 * Mudancas aqui sao mudancas de contrato: atualize docs/CONTRACTS.md, o
 * `schema` em Snapshot e, se houver quebra, docs/adr/.
 *
 * schema 2 (2026-10): multi-GPU por LUID, workloads e commit de memoria.
 */

export type HealthStatus = 'ok' | 'warn' | 'critical' | 'unknown'

export type SourceStatus = 'live' | 'stale' | 'unavailable' | 'disabled'

export interface SourceState {
  status: SourceStatus
  lastUpdate: number | null
  latencyMs: number | null
  error: string | null
  detail: string | null
}

export interface HostInfo {
  hostname: string
  platform: string
  release: string
  arch: string
  uptimeSec: number
  appUptimeSec: number
  elevated: boolean
  cpuModel: string
  /** Nucleos fisicos. Vem do sensor do Windows; cai para os.cpus() quando ausente. */
  cores: number
  /** Nucleos logicos. */
  threads: number
}

export interface CpuSample {
  /** Percentual da capacidade total da maquina (0..100), como no Gerenciador de Tarefas. */
  usagePct: number
  perCorePct: number[]
  loadAvg: [number, number, number] | null
  speedMhz: number | null
}

export interface MemorySample {
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usagePct: number
  /** Commit charge do Windows. Null quando o sensor do Windows esta indisponivel. */
  committedBytes: number | null
  commitLimitBytes: number | null
  /** committed / commitLimit * 100. O sinal mais honesto de pressao de memoria. */
  commitPct: number | null
  cacheBytes: number | null
}

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'microsoft' | 'other'
export type GpuKind = 'discrete' | 'integrated' | 'software'
export type GpuTelemetry = 'nvidia-smi' | 'windows-counters'

export interface GpuProcessInfo {
  pid: number
  /** Id do adaptador (formato `luid:0xHIGH:0xLOW`). */
  adapterId: string
  vramMiB: number
  sharedMiB: number
  /** Maior utilizacao entre os engines do processo (0..100). */
  utilPct: number
  engines: Record<string, number>
}

export interface GpuAdapter {
  /** Id estavel: `luid:0x00000000:0x0000CE41`. */
  id: string
  /** LUID no formato do Windows, usado nos contadores de performance. */
  luid: string
  name: string
  vendor: GpuVendor
  kind: GpuKind
  driver: string | null
  telemetry: GpuTelemetry
  vramTotalMiB: number
  vramUsedMiB: number
  vramFreeMiB: number
  sharedUsedMiB: number
  /** Utilizacao do adaptador: maior engine agregada, como no Gerenciador de Tarefas. */
  utilPct: number
  utilByEngine: Record<string, number>
  memUtilPct: number | null
  tempC: number | null
  powerW: number | null
  powerLimitW: number | null
  clockSmMhz: number | null
  clockMemMhz: number | null
  fanPct: number | null
  processes: GpuProcessInfo[]
}

export interface ProcessRow {
  pid: number
  ppid: number | null
  name: string
  path: string | null
  /** Percentual da capacidade total da maquina (0..100). Null no primeiro tick. */
  cpuPct: number | null
  cpuTimeSec: number | null
  rssBytes: number
  privateBytes: number
  vramMiB: number
  sharedVramMiB: number
  gpuUtilPct: number | null
  /** Adaptadores em que o processo aparece (ids de GpuAdapter). */
  gpuAdapters: string[]
  threads: number
  startedAt: number | null
  isProtected: boolean
  isSelf: boolean
  workloadId: string | null
}

export interface VolumeInfo {
  mount: string
  label: string
  totalBytes: number
  freeBytes: number
  usedPct: number
}

export interface HistorySeries {
  intervalMs: number
  cpu: number[]
  gpu: number[]
  vramMiB: number[]
  ram: number[]
  commit: number[]
}

export type HistoryKey = 'cpu' | 'gpu' | 'vramMiB' | 'ram' | 'commit'

export interface HealthInfo {
  status: HealthStatus
  reasons: string[]
}

export interface SnapshotSources {
  nvidia: SourceState
  windowsSensor: SourceState
  storage: SourceState
  ports: SourceState
}

/**
 * Agrupamento de processos que faz sentido para o operador.
 *
 * Derivado da arvore de processos (ancora = primeiro descendente de um
 * processo de sistema) e enriquecido por regras em src/shared/workloads.ts.
 * E a unidade de "ejetar": derrubar um workload derruba a arvore inteira.
 */
export interface Workload {
  /** `wl:<rootPid>` ou `rule:<ruleId>`. */
  id: string
  label: string
  kind: string
  rootPid: number
  pids: number[]
  processCount: number
  /** Portas TCP em LISTENING cujo dono esta no workload. */
  ports: number[]
  cpuPct: number
  rssBytes: number
  privateBytes: number
  vramMiB: number
  sharedVramMiB: number
  gpuUtilPct: number
  adapters: string[]
  startedAt: number | null
  isProtected: boolean
  isSelf: boolean
}

export interface Snapshot {
  schema: 2
  ts: number
  seq: number
  host: HostInfo
  cpu: CpuSample
  memory: MemorySample
  gpus: GpuAdapter[]
  primaryGpuId: string | null
  processes: ProcessRow[]
  workloads: Workload[]
  volumes: VolumeInfo[]
  history: HistorySeries
  health: HealthInfo
  sources: SnapshotSources
}

export type TerminateMode = 'graceful' | 'force'

export interface TerminateRequest {
  pid: number
  mode: TerminateMode
  /** Guarda contra reuso de PID: se nao bater com o processo atual, recusa. */
  expectedStartedAt?: number | null
}

export interface TerminateWorkloadRequest {
  workloadId: string
  mode: TerminateMode
}

export interface TerminateFailure {
  pid: number
  message: string
}

export interface TerminateResult {
  ok: boolean
  mode: TerminateMode
  targetKind: 'process' | 'workload'
  targetId: string
  targetLabel: string
  requestedPids: number[]
  killedPids: number[]
  failed: TerminateFailure[]
  message: string
  needsForce: boolean
  requiresElevation: boolean
  verified: boolean
  durationMs: number
  vramBeforeMiB: number | null
  vramAfterMiB: number | null
  reclaimedMiB: number | null
  auditId: string
  ts: number
}

export interface AuditEntry {
  id: string
  ts: number
  action: 'terminate' | 'terminate-workload'
  targetKind: 'process' | 'workload'
  targetId: string
  targetLabel: string
  mode: TerminateMode
  origin: 'ui' | 'api' | 'cli'
  allowed: boolean
  reason: string | null
  result: 'success' | 'failed' | 'blocked'
  message: string
  pids: number[]
  durationMs: number
  vramBeforeMiB: number | null
  vramAfterMiB: number | null
}

export interface PolicyDecision {
  allowed: boolean
  reason: string | null
  requiresElevation: boolean
  isProtected: boolean
  label: string
  pids: number[]
}

export interface RuntimeInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  schema: 2
  sampleIntervalMs: number
  historyPoints: number
  actionsEnabled: boolean
  logDir: string
  http: {
    enabled: boolean
    url: string | null
    tokenRequired: boolean
  }
  platform: string
}

/** Payload aceito pela API HTTP quando acoes remotas estao habilitadas. */
export interface HttpTerminateRequest {
  pid?: number
  workloadId?: string
  mode?: TerminateMode
  expectedStartedAt?: number | null
}
