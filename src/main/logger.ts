import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: number
  level: Level
  scope: string
  message: string
  data?: unknown
}

const RING_SIZE = 200
const ring: LogEntry[] = []
let stream: WriteStream | null = null

/** Abre o log em arquivo. Chamado uma vez pelo main/probe. */
export function initLogger(logDir: string, fileName = 'vitals.log'): void {
  try {
    mkdirSync(logDir, { recursive: true })
    stream = createWriteStream(join(logDir, fileName), { flags: 'a' })
  } catch {
    stream = null
  }
}

export function closeLogger(): void {
  stream?.end()
  stream = null
}

function push(level: Level, scope: string, message: string, data?: unknown): void {
  const entry: LogEntry = { ts: Date.now(), level, scope, message, data }
  ring.push(entry)
  if (ring.length > RING_SIZE) ring.shift()

  if (stream) {
    try {
      const suffix = data === undefined ? '' : ` ${safeJson(data)}`
      stream.write(`[${new Date(entry.ts).toISOString()}] ${level.toUpperCase().padEnd(5)} ${scope}: ${message}${suffix}\n`)
    } catch {
      // log nunca derruba o app
    }
  }

  if (process.env.VITALS_LOG_SILENT === '1') return
  if (process.env.VITALS_LOG_LEVEL === 'debug' || level !== 'debug') {
    const line = `[${new Date(entry.ts).toISOString()}] ${level.toUpperCase().padEnd(5)} ${scope}: ${message}`
    if (level === 'error') console.error(line, data ?? '')
    else if (level === 'warn') console.warn(line, data ?? '')
    else console.log(line, data ?? '')
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const log = {
  debug: (scope: string, message: string, data?: unknown) => push('debug', scope, message, data),
  info: (scope: string, message: string, data?: unknown) => push('info', scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => push('warn', scope, message, data),
  error: (scope: string, message: string, data?: unknown) => push('error', scope, message, data),
  recent: (limit = 50): LogEntry[] => ring.slice(-limit)
}
