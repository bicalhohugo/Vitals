import { statfs } from 'node:fs/promises'
import type { SourceState, VolumeInfo } from '@shared/types'

const DRIVE_LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('')

/** Volumes locais via fs.statfs (sem dependencias externas). */
export class StorageSampler {
  private volumes: VolumeInfo[] = []
  private lastSuccessAt: number | null = null
  private lastError: string | null = null
  private lastLatencyMs: number | null = null

  async sample(): Promise<void> {
    if (process.platform !== 'win32') {
      this.lastError = 'volumes Windows disponiveis apenas no Windows'
      return
    }
    const started = Date.now()
    const volumes: VolumeInfo[] = []
    try {
      for (const letter of DRIVE_LETTERS) {
        const mount = `${letter}:\\`
        try {
          const stats = await statfs(mount)
          const totalBytes = stats.bsize * stats.blocks
          if (!Number.isFinite(totalBytes) || totalBytes <= 0) continue
          const freeBytes = stats.bsize * stats.bavail
          volumes.push({
            mount,
            label: `${letter}:`,
            totalBytes,
            freeBytes,
            usedPct: ((totalBytes - freeBytes) / totalBytes) * 100
          })
        } catch {
          // letra sem volume montado
        }
      }
      this.volumes = volumes
      this.lastSuccessAt = Date.now()
      this.lastLatencyMs = Date.now() - started
      this.lastError = null
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  getVolumes(): VolumeInfo[] {
    return this.volumes.map((volume) => ({ ...volume }))
  }

  getState(): SourceState {
    const age = this.lastSuccessAt ? Date.now() - this.lastSuccessAt : null
    let status: SourceState['status'] = 'unavailable'
    if (this.lastSuccessAt) {
      status = age != null && age <= 60_000 ? 'live' : 'stale'
    }
    return {
      status,
      lastUpdate: this.lastSuccessAt,
      latencyMs: this.lastLatencyMs,
      error: this.lastError,
      detail: this.volumes.length > 0 ? `${this.volumes.length} volume(s)` : null
    }
  }
}
