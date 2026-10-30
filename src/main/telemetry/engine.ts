import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import { promisify } from 'node:util'
import type {
  GpuAdapter,
  HistoryKey,
  HistorySeries,
  ProcessRow,
  Snapshot,
  SnapshotSources,
  Workload
} from '@shared/types'
import { log } from '../logger'
import { RingBuffer } from './ring-buffer'
import { averageTail, evaluateHealth } from './health'
import { buildGpuProcesses, buildProcessRows, type PreviousProcessSample } from './processes'
import { buildWorkloads } from './workloads'
import { adapterFromNvidia, NvidiaSampler, normalizeGpuName } from './sources/nvidia'
import { StorageSampler } from './sources/storage'
import { SystemSampler } from './sources/system'
import { PortSampler } from './sources/ports'
import {
  WindowsSensor,
  type SensorAdapter,
  type SensorAdapterUsage,
  type SensorMeta,
  type SensorTick
} from './sources/windows-sensor'

const execFileAsync = promisify(execFile)
const MIB = 1024 * 1024
const KIND_RANK: Record<string, number> = { discrete: 0, integrated: 1, software: 2 }

let elevationPromise: Promise<boolean> | null = null

/** Detecta elevacao UMA vez por processo. `net session` falha sem admin. */
export function detectElevation(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  elevationPromise ??= execFileAsync('net', ['session'], { windowsHide: true, timeout: 4000 })
    .then(() => true)
    .catch(() => false)
  return elevationPromise
}

export interface TelemetryEngineOptions {
  intervalMs: number
  historyPoints: number
  portsIntervalMs?: number
  getSelfPids?: () => number[]
  enableSensor?: boolean
  enableNvidia?: boolean
  enableStorage?: boolean
  enablePorts?: boolean
}

export type SnapshotListener = (snapshot: Snapshot) => void

/**
 * Orquestra as fontes de telemetria e monta o Snapshot.
 *
 * Nao importa `electron`: roda no probe (scripts/probe.ts), na API HTTP e nos
 * testes. E a unica peca que sabe juntar as fontes.
 */
export class TelemetryEngine extends EventEmitter {
  private readonly system = new SystemSampler()
  private readonly sensor: WindowsSensor
  private readonly nvidia: NvidiaSampler
  private readonly storage = new StorageSampler()
  private readonly ports: PortSampler
  private readonly history: {
    cpu: RingBuffer
    gpu: RingBuffer
    vram: RingBuffer
    ram: RingBuffer
    commit: RingBuffer
  }
  private snapshot: Snapshot | null = null
  private seq = 0
  private startedAt = Date.now()
  private timer: NodeJS.Timeout | null = null
  private portsTimer: NodeJS.Timeout | null = null
  private ticking = false
  private elevated = false
  private previousProcesses = new Map<number, PreviousProcessSample>()
  private previousProcessAt: number | null = null
  private lastSensorSeq: number | null = null
  private storageTicks = 0

  constructor(private readonly options: TelemetryEngineOptions) {
    super()
    this.sensor = new WindowsSensor(options.intervalMs)
    this.nvidia = new NvidiaSampler(options.intervalMs)
    this.ports = new PortSampler(options.portsIntervalMs ?? 10_000)
    this.history = {
      cpu: new RingBuffer(options.historyPoints),
      gpu: new RingBuffer(options.historyPoints),
      vram: new RingBuffer(options.historyPoints),
      ram: new RingBuffer(options.historyPoints),
      commit: new RingBuffer(options.historyPoints)
    }
  }

  async start(): Promise<void> {
    this.startedAt = Date.now()
    this.elevated = await detectElevation()
    log.info('engine', 'iniciando', { elevated: this.elevated, intervalMs: this.options.intervalMs })

    const tasks: Promise<unknown>[] = []
    if (this.options.enableNvidia !== false) tasks.push(this.nvidia.sample())
    if (this.options.enableStorage !== false) tasks.push(this.storage.sample())
    if (this.options.enablePorts !== false) tasks.push(this.ports.sample())
    if (this.options.enableSensor !== false) tasks.push(this.sensor.start())
    await Promise.all(tasks)

    this.tick()
    this.timer = setInterval(() => this.tick(), this.options.intervalMs)

    if (this.options.enablePorts !== false) {
      this.portsTimer = setInterval(() => {
        void this.ports.sample()
      }, this.options.portsIntervalMs ?? 10_000)
    }

    log.info('engine', 'primeira amostra publicada', { seq: this.seq })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.portsTimer) clearInterval(this.portsTimer)
    this.timer = null
    this.portsTimer = null
    this.sensor.stop()
    log.info('engine', 'parado')
  }

  getSnapshot(): Snapshot | null {
    return this.snapshot
  }

  getHistory(series: HistoryKey | 'all', points?: number): HistorySeries | number[] {
    if (series === 'all') {
      return {
        intervalMs: this.options.intervalMs,
        cpu: this.slice(this.history.cpu.toArray(), points),
        gpu: this.slice(this.history.gpu.toArray(), points),
        vramMiB: this.slice(this.history.vram.toArray(), points),
        ram: this.slice(this.history.ram.toArray(), points),
        commit: this.slice(this.history.commit.toArray(), points)
      }
    }
    const buffers: Record<HistoryKey, RingBuffer> = {
      cpu: this.history.cpu,
      gpu: this.history.gpu,
      vramMiB: this.history.vram,
      ram: this.history.ram,
      commit: this.history.commit
    }
    return this.slice(buffers[series].toArray(), points)
  }

  getSources(): SnapshotSources {
    return {
      nvidia: this.nvidia.getState(),
      windowsSensor: this.sensor.getState(),
      storage: this.storage.getState(),
      ports: this.ports.getState()
    }
  }

  isElevated(): boolean {
    return this.elevated
  }

  private slice(values: number[], points?: number): number[] {
    if (!points || points >= values.length) return values
    return values.slice(-Math.max(1, points))
  }

  private tick(): void {
    if (this.ticking) return
    this.ticking = true
    try {
      const now = Date.now()
      const systemSample = this.system.sample()
      const tick = this.sensor.getLatest()
      const meta = this.sensor.getMeta()

      const selfPids = new Set<number>([process.pid])
      if (meta.sensorPid != null) selfPids.add(meta.sensorPid)
      try {
        for (const pid of this.options.getSelfPids?.() ?? []) selfPids.add(pid)
      } catch {
        // getSelfPids e opcional e pode falhar durante o shutdown
      }

      const fresh = tick != null && tick.seq !== this.lastSensorSeq
      let rows: ProcessRow[]
      let workloads: Workload[]

      if (fresh && tick) {
        const elapsedMs = this.previousProcessAt ? now - this.previousProcessAt : 0
        const built = buildProcessRows({
          procs: tick.procs,
          gpu: tick.gpu,
          vram: tick.vram,
          previous: this.previousProcesses,
          elapsedMs,
          logicalCpus: Math.max(1, os.cpus().length),
          selfPids,
          now
        })
        this.previousProcesses = built.nextPrevious
        this.previousProcessAt = now
        this.lastSensorSeq = tick.seq

        const grouped = buildWorkloads(built.rows, (pid) => this.ports.getForPid(pid), selfPids)
        workloads = grouped.workloads
        rows = built.rows.map((row) => ({
          ...row,
          workloadId: grouped.byPid.get(row.pid) ?? null
        }))
      } else if (this.snapshot) {
        // O sensor ainda nao publicou um tick novo: reaproveita CPU/workloads em
        // vez de recalcular delta sobre a mesma amostra (o que zeraria tudo).
        rows = this.snapshot.processes
        workloads = this.snapshot.workloads
      } else {
        rows = []
        workloads = []
      }

      const { gpus, primaryGpuId } = this.buildGpus(tick, meta)

      const committedBytes = tick?.mem.committed ?? null
      const commitLimitBytes = tick?.mem.limit ?? null
      const commitPct =
        committedBytes != null && commitLimitBytes != null && commitLimitBytes > 0
          ? (committedBytes / commitLimitBytes) * 100
          : null

      const primary = gpus.find((gpu) => gpu.id === primaryGpuId) ?? null

      const snapshot: Snapshot = {
        schema: 2,
        ts: now,
        seq: ++this.seq,
        host: {
          hostname: os.hostname(),
          platform: `${os.type()} ${os.release()}`,
          release: os.release(),
          arch: os.arch(),
          uptimeSec: os.uptime(),
          appUptimeSec: (now - this.startedAt) / 1000,
          elevated: this.elevated,
          cpuModel: meta.cpuName?.trim() || os.cpus()[0]?.model.trim() || 'CPU desconhecida',
          cores: meta.cores > 0 ? meta.cores : os.cpus().length,
          threads: meta.threads > 0 ? meta.threads : os.cpus().length
        },
        cpu: systemSample.cpu,
        memory: {
          ...systemSample.memory,
          committedBytes,
          commitLimitBytes,
          commitPct,
          cacheBytes: tick?.mem.cache ?? null
        },
        gpus,
        primaryGpuId,
        processes: rows,
        workloads,
        volumes: this.storage.getVolumes(),
        history: {
          intervalMs: this.options.intervalMs,
          cpu: [],
          gpu: [],
          vramMiB: [],
          ram: [],
          commit: []
        },
        health: { status: 'ok', reasons: [] },
        sources: this.getSources()
      }

      this.history.cpu.push(snapshot.cpu.usagePct)
      this.history.gpu.push(primary?.utilPct ?? 0)
      this.history.vram.push(primary?.vramUsedMiB ?? 0)
      this.history.ram.push(snapshot.memory.usagePct)
      this.history.commit.push(commitPct ?? 0)

      snapshot.history = this.getHistory('all') as HistorySeries
      snapshot.health = evaluateHealth(snapshot, averageTail(snapshot.history.cpu, 5))

      this.snapshot = snapshot
      this.emit('snapshot', snapshot)

      this.storageTicks += 1
      if (this.options.enableStorage !== false && this.storageTicks % 10 === 0) {
        void this.storage.sample()
      }
      if (this.options.enableNvidia !== false) {
        void this.nvidia.sample()
      }
    } catch (error) {
      log.error('engine', 'falha no tick', error)
    } finally {
      this.ticking = false
    }
  }

  private buildGpus(
    tick: SensorTick | null,
    meta: SensorMeta
  ): { gpus: GpuAdapter[]; primaryGpuId: string | null } {
    const nvidiaSamples = this.options.enableNvidia === false ? [] : this.nvidia.getAll()
    const gpus: GpuAdapter[] = []

    if (meta.adapters.length === 0) {
      // Sensor indisponivel: entrega o que o nvidia-smi sabe, sem processos.
      for (const sample of nvidiaSamples) gpus.push(adapterFromNvidia(sample))
    } else {
      for (const adapter of meta.adapters) {
        gpus.push(this.buildAdapter(adapter, tick, nvidiaSamples))
      }
    }

    gpus.sort(
      (a, b) =>
        (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || b.vramTotalMiB - a.vramTotalMiB
    )

    const primary =
      gpus.find((gpu) => gpu.kind === 'discrete' && gpu.vramTotalMiB > 0) ??
      gpus.find((gpu) => gpu.kind !== 'software' && gpu.vramTotalMiB > 0) ??
      gpus[0] ??
      null

    return { gpus, primaryGpuId: primary?.id ?? null }
  }

  private buildAdapter(
    adapter: SensorAdapter,
    tick: SensorTick | null,
    nvidiaSamples: ReturnType<NvidiaSampler['getAll']>
  ): GpuAdapter {
    const id = `luid:${adapter.luid}`
    const usage: SensorAdapterUsage | undefined = tick?.adapters.find(
      (entry) => entry.luid === adapter.luid
    )
    const nv =
      adapter.vendor === 'nvidia'
        ? (nvidiaSamples.find(
            (sample) => normalizeGpuName(sample.name) === normalizeGpuName(adapter.name)
          ) ?? null)
        : null

    const vramTotalMiB = nv ? nv.vramTotalMiB : Math.round(adapter.dedicatedBytes / MIB)
    const vramUsedMiB = nv ? nv.vramUsedMiB : Math.round((usage?.dedicated ?? 0) / MIB)
    const sharedUsedMiB = Math.round((usage?.shared ?? 0) / MIB)
    const utilPct = nv ? nv.utilPct : (usage?.util ?? 0)
    const memUtilPct =
      nv?.memUtilPct ?? (vramTotalMiB > 0 ? (vramUsedMiB / vramTotalMiB) * 100 : null)

    const processes = tick
      ? buildGpuProcesses(
          tick.gpu.filter((entry) => entry.luid === adapter.luid),
          tick.vram.filter((entry) => entry.luid === adapter.luid),
          id
        )
      : []

    return {
      id,
      luid: adapter.luid,
      name: adapter.name,
      vendor: (adapter.vendor as GpuAdapter['vendor']) ?? 'other',
      kind: (adapter.kind as GpuAdapter['kind']) ?? 'discrete',
      driver: nv?.driver ?? null,
      telemetry: nv ? 'nvidia-smi' : 'windows-counters',
      vramTotalMiB,
      vramUsedMiB,
      vramFreeMiB: Math.max(0, vramTotalMiB - vramUsedMiB),
      sharedUsedMiB,
      utilPct,
      utilByEngine: usage?.engines ?? {},
      memUtilPct,
      tempC: nv?.tempC ?? null,
      powerW: nv?.powerW ?? null,
      powerLimitW: nv?.powerLimitW ?? null,
      clockSmMhz: nv?.clockSmMhz ?? null,
      clockMemMhz: nv?.clockMemMhz ?? null,
      fanPct: nv?.fanPct ?? null,
      processes
    }
  }
}
