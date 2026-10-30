import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditEntry } from '@shared/types'
import { log } from '../logger'

const RING_SIZE = 300

/**
 * Trilha de auditoria. JSONL em disco + ring em memoria para a UI.
 *
 * Toda tentativa entra aqui, inclusive as bloqueadas: saber o que foi negado
 * tambem e operacao.
 */
export class AuditLog {
  private ring: AuditEntry[] = []
  private readonly file: string

  constructor(logDir: string) {
    this.file = join(logDir, 'audit.jsonl')
    try {
      mkdirSync(logDir, { recursive: true })
    } catch {
      // o append falha depois; nao impede o app de subir
    }
  }

  append(entry: AuditEntry): void {
    this.ring.push(entry)
    if (this.ring.length > RING_SIZE) this.ring.shift()
    try {
      appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch (error) {
      log.warn('audit', 'falha ao gravar auditoria', error instanceof Error ? error.message : error)
    }
  }

  recent(limit = 50): AuditEntry[] {
    return this.ring.slice(-Math.max(1, limit)).reverse()
  }

  get path(): string {
    return this.file
  }
}

export function newAuditId(): string {
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
