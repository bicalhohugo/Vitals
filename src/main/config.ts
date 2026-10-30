import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface AppConfig {
  sampleIntervalMs: number
  historyPoints: number
  http: {
    enabled: boolean
    host: string
    port: number
    /** Exigido para POST quando definido. Vazio = acoes remotas desligadas. */
    token: string
  }
  actions: {
    enabled: boolean
    /** Permite POST /api/terminate na API HTTP. Requer token. */
    remoteEnabled: boolean
    gracefulTimeoutMs: number
  }
  logDir: string
  portsIntervalMs: number
  /** Icone na bandeja e fechar a janela minimiza para ela. */
  tray: boolean
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase())
}

function defaultLogDir(): string {
  if (process.env.VITALS_LOG_DIR) return process.env.VITALS_LOG_DIR
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'Vitals', 'logs')
  }
  return join(homedir(), '.local', 'share', 'vitals', 'logs')
}

/** Caminhos candidatos para o .env, do mais obvio ao especifico do pacote. */
function dotEnvCandidates(cwd: string): string[] {
  const candidates = [join(cwd, '.env')]
  // electron-builder portable define esta variavel com a pasta do .exe real.
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) candidates.push(join(portableDir, '.env'))
  // Instalado (NSIS/dir): .env ao lado do executavel.
  const exeDir = dirname(process.execPath)
  if (exeDir) candidates.push(join(exeDir, '.env'))
  return [...new Set(candidates)]
}

/** Carrega .env do diretorio de trabalho ou de ao lado do executavel. */
export function loadDotEnv(cwd = process.cwd()): void {
  for (const file of dotEnvCandidates(cwd)) {
    if (!existsSync(file)) continue
    try {
      process.loadEnvFile(file)
      return
    } catch {
      // .env invalido nao deve impedir o app de subir; o doctor mostra o problema.
    }
  }
}

export function loadConfig(): AppConfig {
  const sampleIntervalMs = envInt('VITALS_SAMPLE_MS', 1500, 500, 10000)
  const token = (process.env.VITALS_HTTP_TOKEN ?? '').trim()
  const remoteEnabled = envBool('VITALS_REMOTE_ACTIONS', false) && token.length >= 16
  return {
    sampleIntervalMs,
    historyPoints: envInt('VITALS_HISTORY_POINTS', 120, 10, 600),
    http: {
      enabled: envBool('VITALS_HTTP', true),
      host: '127.0.0.1',
      port: envInt('VITALS_HTTP_PORT', 4780, 1024, 65535),
      token
    },
    actions: {
      enabled: envBool('VITALS_ACTIONS', true),
      remoteEnabled,
      gracefulTimeoutMs: envInt('VITALS_GRACEFUL_TIMEOUT_MS', 3000, 500, 15000)
    },
    logDir: defaultLogDir(),
    portsIntervalMs: envInt('VITALS_PORTS_MS', 10_000, 3000, 60_000),
    tray: envBool('VITALS_TRAY', true)
  }
}
