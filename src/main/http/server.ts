import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import type { HttpTerminateRequest, RuntimeInfo, Snapshot } from '@shared/types'
import type { ActionService } from '../actions/terminate'
import type { AppConfig } from '../config'
import { log } from '../logger'
import type { TelemetryEngine } from '../telemetry/engine'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
}

export interface HttpServerOptions {
  config: AppConfig
  engine: TelemetryEngine
  actions: ActionService
  runtime: () => RuntimeInfo
  /** Diretorio de arquivos estaticos do renderer (out/renderer). */
  staticDir: string | null
}

/**
 * API local somente-leitura + acoes opcionais.
 *
 * Por padrao escuta apenas 127.0.0.1. POST /api/terminate exige
 * VITALS_REMOTE_ACTIONS=1 e um token de >=16 chars em VITALS_HTTP_TOKEN.
 */
export class VitalsHttpServer {
  private server: Server | null = null
  private readonly streams = new Set<ServerResponse>()
  private readonly staticRoot: string | null

  constructor(private readonly options: HttpServerOptions) {
    this.staticRoot = options.staticDir ? resolve(options.staticDir) : null
  }

  start(): string | null {
    if (this.server) return this.url()
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        log.error('http', 'falha no handler', error)
        this.json(res, 500, { error: 'internal_error' })
      })
    })
    this.server.listen(this.options.config.http.port, this.options.config.http.host)
    this.server.on('error', (error) => log.warn('http', 'erro no servidor', error.message))

    this.options.engine.on('snapshot', this.onSnapshot)
    log.info('http', `escutando em ${this.url()}`)
    return this.url()
  }

  stop(): void {
    this.options.engine.off('snapshot', this.onSnapshot)
    for (const stream of this.streams) stream.end()
    this.streams.clear()
    this.server?.close()
    this.server = null
  }

  url(): string {
    return `http://${this.options.config.http.host}:${this.options.config.http.port}`
  }

  private onSnapshot = (snapshot: Snapshot): void => {
    if (this.streams.size === 0) return
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`
    for (const stream of this.streams) {
      try {
        stream.write(payload)
      } catch {
        this.streams.delete(stream)
      }
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url())
    const path = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }

    if (path === '/api/health') {
      this.json(res, 200, {
        ok: true,
        schema: 2,
        uptimeSec: Math.round(this.options.engine.getSnapshot()?.host.appUptimeSec ?? 0),
        ts: Date.now()
      })
      return
    }

    if (path === '/api/snapshot') {
      const snapshot = this.options.engine.getSnapshot()
      if (!snapshot) {
        this.json(res, 503, { error: 'no_snapshot' })
        return
      }
      this.json(res, 200, snapshot)
      return
    }

    if (path === '/api/history') {
      const series = (url.searchParams.get('series') ?? 'all') as 'all'
      const points = Number.parseInt(url.searchParams.get('points') ?? '', 10)
      this.json(res, 200, this.options.engine.getHistory(series, Number.isFinite(points) ? points : undefined))
      return
    }

    if (path === '/api/runtime') {
      this.json(res, 200, this.options.runtime())
      return
    }

    if (path === '/api/audit') {
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10)
      this.json(res, 200, this.options.actions.getAudit(Number.isFinite(limit) ? limit : 50))
      return
    }

    if (path === '/api/events') {
      this.openStream(req, res)
      return
    }

    if (path === '/api/terminate') {
      await this.handleTerminate(req, res)
      return
    }

    this.serveStatic(path, res)
  }

  private openStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })
    res.write('retry: 2000\n\n')
    this.streams.add(res)
    const snapshot = this.options.engine.getSnapshot()
    if (snapshot) res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
    req.on('close', () => {
      this.streams.delete(res)
    })
  }

  private async handleTerminate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      this.json(res, 405, { error: 'method_not_allowed' })
      return
    }
    if (!this.options.config.actions.remoteEnabled) {
      this.json(res, 403, {
        error: 'remote_actions_disabled',
        hint: 'Defina VITALS_REMOTE_ACTIONS=1 e VITALS_HTTP_TOKEN (>=16 chars) para habilitar.'
      })
      return
    }
    if (!this.authorized(req)) {
      this.json(res, 401, { error: 'unauthorized' })
      return
    }

    const body = await readJson<HttpTerminateRequest>(req, 64 * 1024)
    if (!body) {
      this.json(res, 400, { error: 'invalid_json' })
      return
    }

    const mode = body.mode === 'force' ? 'force' : 'graceful'
    if (body.workloadId) {
      const result = await this.options.actions.terminateWorkload(
        { workloadId: body.workloadId, mode },
        'api'
      )
      this.json(res, result.ok ? 200 : 409, result)
      return
    }
    if (typeof body.pid === 'number') {
      const result = await this.options.actions.terminate(
        { pid: body.pid, mode, expectedStartedAt: body.expectedStartedAt ?? null },
        'api'
      )
      this.json(res, result.ok ? 200 : 409, result)
      return
    }
    this.json(res, 400, { error: 'pid_or_workload_required' })
  }

  private authorized(req: IncomingMessage): boolean {
    const expected = this.options.config.http.token
    if (!expected) return false
    const header = req.headers.authorization ?? ''
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
    const provided = bearer || String(req.headers['x-vitals-token'] ?? '')
    if (provided.length !== expected.length) return false
    try {
      return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    } catch {
      return false
    }
  }

  private serveStatic(pathname: string, res: ServerResponse): void {
    if (!this.staticRoot) {
      this.json(res, 404, { error: 'not_found' })
      return
    }
    const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
    let filePath = resolve(join(this.staticRoot, relative || 'index.html'))
    if (!filePath.startsWith(this.staticRoot)) {
      this.json(res, 403, { error: 'forbidden' })
      return
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(this.staticRoot, 'index.html')
      if (!existsSync(filePath)) {
        this.json(res, 404, { error: 'not_found' })
        return
      }
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    createReadStream(filePath).pipe(res)
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    res.end(payload)
  }
}

async function readJson<T>(req: IncomingMessage, limit: number): Promise<T | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) return null
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    return null
  }
}
