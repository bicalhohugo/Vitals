import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GpuAdapter, SourceState } from '@shared/types'
import { log } from '../../logger'

const execFileAsync = promisify(execFile)

const FIELDS = [
  'name',
  'driver_version',
  'memory.total',
  'memory.used',
  'memory.free',
  'utilization.gpu',
  'utilization.memory',
  'temperature.gpu',
  'power.draw',
  'power.limit',
  'clocks.sm',
  'clocks.mem',
  'fan.speed'
] as const

function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null
  const value = raw.trim()
  if (!value || value === 'N/A' || value === '[N/A]' || value === 'N/A %') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

export interface NvidiaSample {
  index: number
  name: string
  driver: string
  vramTotalMiB: number
  vramUsedMiB: number
  vramFreeMiB: number
  utilPct: number
  memUtilPct: number | null
  tempC: number | null
  powerW: number | null
  powerLimitW: number | null
  clockSmMhz: number | null
  clockMemMhz: number | null
  fanPct: number | null
}

/** Converte uma linha CSV do nvidia-smi em amostra. Exportado para teste. */
export function parseNvidiaCsvLine(line: string, index = 0): NvidiaSample | null {
  const parts = line.split(',').map((part) => part.trim())
  if (parts.length < FIELDS.length) return null
  const name = parts[0]
  if (!name) return null
  return {
    index,
    name,
    driver: parts[1] ?? 'unknown',
    vramTotalMiB: parseNumber(parts[2]) ?? 0,
    vramUsedMiB: parseNumber(parts[3]) ?? 0,
    vramFreeMiB: parseNumber(parts[4]) ?? 0,
    utilPct: parseNumber(parts[5]) ?? 0,
    memUtilPct: parseNumber(parts[6]),
    tempC: parseNumber(parts[7]),
    powerW: parseNumber(parts[8]),
    powerLimitW: parseNumber(parts[9]),
    clockSmMhz: parseNumber(parts[10]),
    clockMemMhz: parseNumber(parts[11]),
    fanPct: parseNumber(parts[12])
  }
}

/**
 * Fontes NVIDIA. O nvidia-smi nao expoe LUID, entao o pareamento com o
 * adaptador do Windows e feito pelo nome normalizado (ver docs/adr/0002).
 */
export class NvidiaSampler {
  private latest: NvidiaSample[] = []
  private lastSuccessAt: number | null = null
  private lastError: string | null = null
  private lastLatencyMs: number | null = null
  private inFlight = false
  private everSucceeded = false

  constructor(private readonly intervalMs: number) {}

  async sample(): Promise<void> {
    if (this.inFlight) return
    this.inFlight = true
    const started = Date.now()
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        [`--query-gpu=${FIELDS.join(',')}`, '--format=csv,noheader,nounits'],
        { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }
      )
      const gpus = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => parseNvidiaCsvLine(line, index))
        .filter((gpu): gpu is NvidiaSample => gpu !== null)

      if (gpus.length === 0) {
        throw new Error('nvidia-smi nao retornou GPUs')
      }

      this.latest = gpus
      this.lastSuccessAt = Date.now()
      this.lastLatencyMs = Date.now() - started
      this.lastError = null
      this.everSucceeded = true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const notFound = /ENOENT/i.test(message)
      this.lastError = notFound ? 'nvidia-smi nao encontrado no PATH' : message.slice(0, 300)
      if (!this.everSucceeded) log.warn('nvidia', this.lastError)
    } finally {
      this.inFlight = false
    }
  }

  getAll(): NvidiaSample[] {
    return this.latest.map((gpu) => ({ ...gpu }))
  }

  getPrimary(): NvidiaSample | null {
    const gpu = this.latest[0]
    return gpu ? { ...gpu } : null
  }

  /** Pareia pelo nome normalizado; retorna null quando nao ha correspondencia. */
  findByName(name: string): NvidiaSample | null {
    const normalized = normalizeGpuName(name)
    const found = this.latest.find((gpu) => normalizeGpuName(gpu.name) === normalized)
    return found ? { ...found } : null
  }

  getState(): SourceState {
    const age = this.lastSuccessAt ? Date.now() - this.lastSuccessAt : null
    let status: SourceState['status'] = 'unavailable'
    if (this.lastSuccessAt) {
      status = age != null && age <= Math.max(6000, this.intervalMs * 4) ? 'live' : 'stale'
    }
    return {
      status,
      lastUpdate: this.lastSuccessAt,
      latencyMs: this.lastLatencyMs,
      error: this.lastError,
      detail: this.latest.length > 0 ? `${this.latest.length} GPU(s) · nvidia-smi` : null
    }
  }
}

export function normalizeGpuName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Cria um adaptador a partir do nvidia-smi quando o sensor do Windows falhou. */
export function adapterFromNvidia(sample: NvidiaSample): GpuAdapter {
  return {
    id: 'nvidia:0',
    luid: 'nvidia:0',
    name: sample.name,
    vendor: 'nvidia',
    kind: 'discrete',
    driver: sample.driver,
    telemetry: 'nvidia-smi',
    vramTotalMiB: sample.vramTotalMiB,
    vramUsedMiB: sample.vramUsedMiB,
    vramFreeMiB: sample.vramFreeMiB,
    sharedUsedMiB: 0,
    utilPct: sample.utilPct,
    utilByEngine: {},
    memUtilPct: sample.memUtilPct,
    tempC: sample.tempC,
    powerW: sample.powerW,
    powerLimitW: sample.powerLimitW,
    clockSmMhz: sample.clockSmMhz,
    clockMemMhz: sample.clockMemMhz,
    fanPct: sample.fanPct,
    processes: []
  }
}
