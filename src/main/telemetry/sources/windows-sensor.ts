import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { SourceState } from '@shared/types'
import { log } from '../../logger'

export interface SensorProcess {
  id: number
  ppid: number
  name: string
  ws: number
  priv: number
  cpu: number | null
  threads: number
  path: string | null
  start: number | null
}

export interface SensorGpuProcess {
  pid: number
  luid: string
  util: number
  engines: Record<string, number>
}

export interface SensorVramProcess {
  pid: number
  luid: string
  dedicated: number
  shared: number
}

export interface SensorAdapter {
  luid: string
  name: string
  vendor: string
  kind: string
  dedicatedBytes: number
  sharedBytes: number
}

export interface SensorAdapterUsage {
  luid: string
  dedicated: number
  shared: number
  util: number
  engines: Record<string, number>
}

export interface SensorTick {
  t: number
  seq: number
  sampleMs: number
  procs: SensorProcess[]
  gpu: SensorGpuProcess[]
  vram: SensorVramProcess[]
  adapters: SensorAdapterUsage[]
  mem: {
    committed: number | null
    limit: number | null
    cache: number | null
  }
  errors: string[]
}

interface SensorHello {
  type: 'hello'
  pid: number
  intervalMs: number
  gpuCounters: number
  vramCounters: number
  memCounters: number
  cpuName: string | null
  cores: number
  threads: number
  native: boolean
  adapters: SensorAdapter[]
  errors: string[]
}

export interface SensorMeta {
  exe: string | null
  sensorPid: number | null
  gpuCounters: number
  vramCounters: number
  memCounters: number
  restarts: number
  lastSeq: number
  lastSampleMs: number | null
  cpuName: string | null
  cores: number
  threads: number
  native: boolean
  adapters: SensorAdapter[]
}

const SCRIPT_NAME = 'vitals-windows-sensor.ps1'
const SENSOR_FILE = 'windows-sensor.ps1'
const MAX_RESTART_DELAY_MS = 10_000

/**
 * O .ps1 e lido do disco (e nao importado como `?raw`) para funcionar tanto no
 * bundle do Electron quanto no `tsx scripts/probe.ts`. O build copia o arquivo
 * para out/main (scripts/copy-assets.mjs). Ver docs/adr/0004.
 */
export function resolveSensorScript(): string | null {
  const candidates: string[] = []
  if (typeof __dirname === 'string') candidates.push(join(__dirname, SENSOR_FILE))
  candidates.push(join(process.cwd(), 'src/main/telemetry/sources', SENSOR_FILE))
  if (typeof __dirname === 'string') {
    candidates.push(join(__dirname, '..', '..', '..', 'src/main/telemetry/sources', SENSOR_FILE))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, 'utf8')
      } catch {
        // tenta o proximo
      }
    }
  }
  return null
}

function findExecutable(names: string[]): string | null {
  const pathExt = (process.env.PATHEXT ?? '.EXE').split(';').filter(Boolean)
  const dirs = (process.env.PATH ?? '').split(';').filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of pathExt) {
        const candidate = join(dir, `${name}${ext}`)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object') return [value as T]
  return []
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeEngines(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = toNumber(raw)
    if (parsed != null) out[key] = parsed
  }
  return out
}

function normalizeTick(raw: Record<string, unknown>): SensorTick {
  const mem = (raw.mem ?? {}) as Record<string, unknown>
  return {
    t: toNumber(raw.t) ?? Date.now(),
    seq: toNumber(raw.seq) ?? 0,
    sampleMs: toNumber(raw.sampleMs) ?? 0,
    procs: asArray<Record<string, unknown>>(raw.procs).map((p) => ({
      id: Number(p.id),
      ppid: toNumber(p.ppid) ?? -1,
      name: String(p.name ?? 'unknown'),
      ws: Number(p.ws ?? 0),
      priv: Number(p.priv ?? 0),
      cpu: toNumber(p.cpu),
      threads: Number(p.threads ?? 0),
      path: typeof p.path === 'string' ? p.path : null,
      start: toNumber(p.start)
    })),
    gpu: asArray<Record<string, unknown>>(raw.gpu).map((g) => ({
      pid: Number(g.pid),
      luid: String(g.luid ?? 'unknown'),
      util: Number(g.util ?? 0),
      engines: normalizeEngines(g.engines)
    })),
    vram: asArray<Record<string, unknown>>(raw.vram).map((v) => ({
      pid: Number(v.pid),
      luid: String(v.luid ?? 'unknown'),
      dedicated: Number(v.dedicated ?? 0),
      shared: Number(v.shared ?? 0)
    })),
    adapters: asArray<Record<string, unknown>>(raw.adapters).map((a) => ({
      luid: String(a.luid ?? 'unknown'),
      dedicated: Number(a.dedicated ?? 0),
      shared: Number(a.shared ?? 0),
      util: Number(a.util ?? 0),
      engines: normalizeEngines(a.engines)
    })),
    mem: {
      committed: toNumber(mem.committed),
      limit: toNumber(mem.limit),
      cache: toNumber(mem.cache)
    },
    errors: asArray<string>(raw.errors).map(String)
  }
}

/**
 * Mantem o processo PowerShell do sensor vivo e entrega o ultimo tick.
 *
 * Se o processo morrer (ou parar de emitir), reinicia com backoff. O sensor
 * tambem se auto-encerra quando o PID pai desaparece, evitando orfaos.
 */
export class WindowsSensor {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null
  private latest: SensorTick | null = null
  private lastLineAt: number | null = null
  private lastError: string | null = null
  private stopped = false
  private buffer = ''
  private restartTimer: NodeJS.Timeout | null = null
  private watchdog: NodeJS.Timeout | null = null
  private scriptPath: string | null = null
  private stderrLines: string[] = []
  private meta: SensorMeta = {
    exe: null,
    sensorPid: null,
    gpuCounters: 0,
    vramCounters: 0,
    memCounters: 0,
    restarts: 0,
    lastSeq: 0,
    lastSampleMs: null,
    cpuName: null,
    cores: 0,
    threads: 0,
    native: false,
    adapters: []
  }

  constructor(
    private readonly intervalMs: number,
    private readonly staleAfterMs: number = Math.max(6000, intervalMs * 4)
  ) {}

  async start(): Promise<void> {
    if (process.platform !== 'win32') {
      this.lastError = 'sensor Windows disponivel apenas no Windows'
      return
    }
    this.stopped = false
    if (!this.ensureScript()) return
    this.spawnSensor()
    this.watchdog = setInterval(() => this.checkWatchdog(), 1000)
    await this.waitForFirstTick(15_000)
  }

  stop(): void {
    this.stopped = true
    if (this.watchdog) clearInterval(this.watchdog)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.watchdog = null
    this.restartTimer = null
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        // ignore
      }
      this.child = null
    }
  }

  getLatest(): SensorTick | null {
    return this.latest
  }

  getState(): SourceState {
    const now = Date.now()
    const age = this.lastLineAt ? now - this.lastLineAt : null
    let status: SourceState['status'] = 'unavailable'
    if (this.latest && age != null) {
      status = age <= this.staleAfterMs ? 'live' : 'stale'
    }
    return {
      status,
      lastUpdate: this.lastLineAt,
      latencyMs: this.meta.lastSampleMs,
      error: this.lastError,
      detail: this.meta.exe
        ? `${this.meta.exe.split('\\').pop()} · ${this.meta.adapters.length} adaptador(es) · ${this.meta.restarts} reinicio(s)`
        : null
    }
  }

  getMeta(): SensorMeta {
    return { ...this.meta, adapters: [...this.meta.adapters] }
  }

  private ensureScript(): boolean {
    const script = resolveSensorScript()
    if (!script) {
      this.lastError = `${SENSOR_FILE} nao encontrado (procure em src/main/telemetry/sources)`
      log.error('sensor', this.lastError)
      return false
    }
    try {
      const dir = join(tmpdir(), 'vitals')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, SCRIPT_NAME)
      writeFileSync(file, script, 'utf8')
      this.scriptPath = file
      return true
    } catch (error) {
      this.lastError = `falha ao preparar o sensor: ${error instanceof Error ? error.message : String(error)}`
      log.error('sensor', this.lastError)
      return false
    }
  }

  private resolvePowerShell(): string | null {
    if (this.meta.exe && existsSync(this.meta.exe)) return this.meta.exe
    const found = findExecutable(['pwsh', 'powershell'])
    if (found) {
      this.meta.exe = found
      return found
    }
    const fallback = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    if (existsSync(fallback)) {
      this.meta.exe = fallback
      return fallback
    }
    return null
  }

  private spawnSensor(): void {
    if (this.stopped || !this.scriptPath) return
    const exe = this.resolvePowerShell()
    if (!exe) {
      this.lastError = 'PowerShell nao encontrado no PATH'
      log.error('sensor', this.lastError)
      return
    }

    log.info('sensor', `iniciando ${exe}`)
    const child = spawn(
      exe,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.scriptPath,
        '-IntervalMs',
        String(this.intervalMs),
        '-ParentPid',
        String(process.pid)
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    this.child = child
    this.buffer = ''
    this.stderrLines = []

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrLines.push(chunk)
      if (this.stderrLines.length > 20) this.stderrLines.shift()
      log.debug('sensor', 'stderr', chunk.trim().slice(0, 400))
    })

    child.on('error', (error) => {
      this.lastError = `falha ao iniciar sensor: ${error.message}`
      log.error('sensor', this.lastError)
    })

    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null
      if (this.stopped) return
      const stderr = this.stderrLines.join('').trim().slice(-400)
      this.lastError = `sensor encerrou (code=${code ?? 'null'} signal=${signal ?? 'null'})${stderr ? `: ${stderr}` : ''}`
      log.warn('sensor', this.lastError)
      this.scheduleRestart()
    })
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return
    const delay = Math.min(MAX_RESTART_DELAY_MS, 500 * 2 ** this.meta.restarts)
    this.meta.restarts += 1
    log.info('sensor', `reiniciando em ${delay}ms`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnSensor()
    }, delay)
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.handleLine(line)
      index = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > 4_000_000) this.buffer = ''
  }

  private handleLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      log.debug('sensor', 'linha invalida', line.slice(0, 200))
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    const record = parsed as Record<string, unknown>

    if (record.type === 'hello') {
      const hello = record as unknown as SensorHello
      this.meta.gpuCounters = hello.gpuCounters ?? 0
      this.meta.sensorPid = typeof hello.pid === 'number' ? hello.pid : null
      this.meta.vramCounters = hello.vramCounters ?? 0
      this.meta.memCounters = hello.memCounters ?? 0
      this.meta.cpuName = hello.cpuName ?? null
      this.meta.cores = hello.cores ?? 0
      this.meta.threads = hello.threads ?? 0
      this.meta.native = Boolean(hello.native)
      this.meta.adapters = asArray<SensorAdapter>(hello.adapters)
      log.info('sensor', 'handshake', {
        pid: hello.pid,
        native: hello.native,
        adapters: this.meta.adapters.map((adapter) => `${adapter.name} [${adapter.luid}]`),
        errors: hello.errors
      })
      return
    }

    if (record.type !== 'tick') return
    const tick = normalizeTick(record)
    this.latest = tick
    this.lastLineAt = Date.now()
    this.meta.lastSeq = tick.seq
    this.meta.lastSampleMs = tick.sampleMs
    this.lastError = null
    this.meta.restarts = 0
  }

  private checkWatchdog(): void {
    if (this.stopped) return
    if (!this.child) return
    if (!this.lastLineAt) return
    const age = Date.now() - this.lastLineAt
    if (age <= this.staleAfterMs) return
    this.lastError = `sensor sem resposta ha ${Math.round(age / 1000)}s`
    log.warn('sensor', this.lastError)
    try {
      this.child.kill()
    } catch {
      // o handler de exit agenda o restart
    }
  }

  private async waitForFirstTick(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.latest) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!this.latest) {
      this.lastError = this.lastError ?? 'sensor nao entregou a primeira amostra'
      log.warn('sensor', this.lastError)
    }
  }
}
