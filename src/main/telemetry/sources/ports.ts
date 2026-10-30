import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SourceState } from '@shared/types'
import { log } from '../../logger'

const execFileAsync = promisify(execFile)

/**
 * Mapa pid -> portas TCP em LISTENING.
 *
 * netstat e mais barato que Get-NetTCPConnection (~30ms vs ~90ms) e nao exige
 * elevacao. Roda a cada ~10s, nao a cada tick.
 */
export class PortSampler {
  private byPid = new Map<number, number[]>()
  private lastSuccessAt: number | null = null
  private lastError: string | null = null
  private lastLatencyMs: number | null = null
  private inFlight = false

  constructor(private readonly intervalMs: number) {}

  async sample(): Promise<void> {
    if (process.platform !== 'win32' || this.inFlight) return
    this.inFlight = true
    const started = Date.now()
    try {
      const { stdout } = await execFileAsync('netstat', ['-ano'], {
        timeout: 8000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      })
      this.byPid = parseNetstat(stdout)
      this.lastSuccessAt = Date.now()
      this.lastLatencyMs = Date.now() - started
      this.lastError = null
    } catch (error) {
      this.lastError = error instanceof Error ? error.message.slice(0, 200) : String(error)
      log.debug('ports', 'falha ao ler netstat', this.lastError)
    } finally {
      this.inFlight = false
    }
  }

  getForPid(pid: number): number[] {
    return this.byPid.get(pid) ?? []
  }

  getState(): SourceState {
    const age = this.lastSuccessAt ? Date.now() - this.lastSuccessAt : null
    let status: SourceState['status'] = 'unavailable'
    if (this.lastSuccessAt) {
      status = age != null && age <= Math.max(30_000, this.intervalMs * 3) ? 'live' : 'stale'
    }
    return {
      status,
      lastUpdate: this.lastSuccessAt,
      latencyMs: this.lastLatencyMs,
      error: this.lastError,
      detail: this.byPid.size > 0 ? `${this.byPid.size} processo(s) com porta` : null
    }
  }
}

/** Exportado para teste. Ignora linhas que nao sejam TCP LISTENING. */
export function parseNetstat(stdout: string): Map<number, number[]> {
  const byPid = new Map<number, number[]>()
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || !line.startsWith('TCP')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 5) continue
    const state = parts[3]
    if (state !== 'LISTENING') continue
    const local = parts[1]
    const pid = Number.parseInt(parts[4], 10)
    if (!Number.isInteger(pid) || pid <= 0) continue
    const colon = local.lastIndexOf(':')
    if (colon < 0) continue
    const port = Number.parseInt(local.slice(colon + 1), 10)
    if (!Number.isFinite(port)) continue
    const list = byPid.get(pid)
    if (list) {
      if (!list.includes(port)) list.push(port)
    } else {
      byPid.set(pid, [port])
    }
  }
  return byPid
}
