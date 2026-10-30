/**
 * Probe: roda o motor sem Electron.
 *
 *   npm run probe                 imprime um snapshot resumido e sai
 *   npm run probe -- --json       imprime o Snapshot completo (JSON)
 *   npm run probe -- --watch      imprime um resumo a cada amostra
 *   npm run probe:serve           sobe a API + o renderer em http://127.0.0.1:4780
 *
 * E a forma mais rapida de validar sensores numa maquina nova (ou por um
 * agente, sem abrir janela). Ver docs/OPERATIONS.md.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeInfo, Snapshot } from '@shared/types'
import { formatBytes, formatClock, formatMiB, formatPct, formatTemp, formatWatts } from '@shared/format'
import { loadConfig, loadDotEnv } from '../src/main/config'
import { initLogger, closeLogger, log } from '../src/main/logger'
import { TelemetryEngine } from '../src/main/telemetry/engine'
import { ActionService } from '../src/main/actions/terminate'
import { VitalsHttpServer } from '../src/main/http/server'

const args = new Set(process.argv.slice(2))
// --json precisa de stdout limpo: sem banner, sem log.
if (args.has('--json')) process.env.VITALS_LOG_SILENT = '1'
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
loadDotEnv()
const config = loadConfig()
initLogger(config.logDir, 'probe.log')

const engine = new TelemetryEngine({
  intervalMs: config.sampleIntervalMs,
  historyPoints: config.historyPoints,
  portsIntervalMs: config.portsIntervalMs,
  getSelfPids: () => [process.pid]
})
const actions = new ActionService(engine, config)

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function summarize(snapshot: Snapshot): string {
  const lines: string[] = []
  const primary = snapshot.gpus.find((gpu) => gpu.id === snapshot.primaryGpuId)
  lines.push(
    `VITALS ${formatClock(snapshot.ts)} · ${snapshot.host.hostname} · ${snapshot.health.status.toUpperCase()}`
  )
  lines.push(
    `CPU ${formatPct(snapshot.cpu.usagePct)} · RAM ${formatPct(snapshot.memory.usagePct)} (${formatBytes(
      snapshot.memory.usedBytes
    )}) · commit ${formatPct(snapshot.memory.commitPct)}`
  )
  if (primary) {
    lines.push(
      `GPU ${primary.name} · ${formatPct(primary.utilPct)} · VRAM ${formatMiB(
        primary.vramUsedMiB
      )}/${formatMiB(primary.vramTotalMiB)} · ${formatTemp(primary.tempC)} · ${formatWatts(
        primary.powerW
      )}`
    )
  } else {
    lines.push('GPU indisponivel')
  }

  if (snapshot.health.reasons.length > 0) {
    lines.push(`! ${snapshot.health.reasons.join(' | ')}`)
  }

  lines.push('')
  lines.push('WORKLOADS')
  for (const workload of snapshot.workloads.slice(0, 8)) {
    const ports = workload.ports.length > 0 ? ` :${workload.ports.join(',')}` : ''
    lines.push(
      `  ${workload.label.padEnd(18)} ${formatMiB(workload.vramMiB).padStart(8)} VRAM  ${formatBytes(
        workload.privateBytes
      ).padStart(8)} commit  ${formatPct(workload.cpuPct).padStart(6)} CPU  ${String(
        workload.processCount
      ).padStart(2)} proc${ports}`
    )
  }

  lines.push('')
  lines.push('TOP PROCESSOS (VRAM)')
  const top = [...snapshot.processes].sort((a, b) => b.vramMiB - a.vramMiB).slice(0, 6)
  for (const process of top) {
    lines.push(
      `  ${String(process.pid).padStart(6)}  ${process.name.padEnd(22)} ${formatMiB(
        process.vramMiB
      ).padStart(8)} VRAM  ${formatBytes(process.privateBytes).padStart(8)} commit`
    )
  }

  const sources = Object.entries(snapshot.sources)
    .map(([name, state]) => `${name}=${state.status}`)
    .join(' ')
  lines.push('')
  lines.push(`fontes: ${sources}`)
  return lines.join('\n')
}

async function main(): Promise<void> {
  await engine.start()

  if (args.has('--serve')) {
    const rendererDir = join(process.cwd(), 'out/renderer')
    let serverUrl: string | null = null
    const runtime = (): RuntimeInfo => ({
      appVersion: packageVersion(),
      electronVersion: 'n/a',
      nodeVersion: process.versions.node,
      schema: 2,
      sampleIntervalMs: config.sampleIntervalMs,
      historyPoints: config.historyPoints,
      actionsEnabled: config.actions.enabled,
      logDir: config.logDir,
      http: {
        enabled: config.http.enabled,
        url: serverUrl,
        tokenRequired: config.http.token !== ''
      },
      platform: process.platform
    })
    const server = new VitalsHttpServer({
      config,
      engine,
      actions,
      staticDir: existsSync(join(rendererDir, 'index.html')) ? rendererDir : null,
      runtime
    })
    serverUrl = server.start()
    console.log(`\n  Vitals probe em ${serverUrl}`)
    if (!existsSync(join(rendererDir, 'index.html'))) {
      console.log('  (renderer nao compilado: rode `npm run build` para servir a UI)')
    }
    console.log('  Ctrl+C para sair\n')
    hold()
    return
  }

  if (args.has('--watch')) {
    let count = 0
    engine.on('snapshot', (snapshot: Snapshot) => {
      console.clear()
      console.log(summarize(snapshot))
      count += 1
      if (count === 1) log.info('probe', 'acompanhando (Ctrl+C para sair)')
    })
    hold()
    return
  }

  const first = await waitForSnapshot()
  if (!first) {
    console.error('sem amostra: verifique o sensor (npm run doctor)')
    shutdown(1)
    return
  }

  // CPU% por processo e delta: espera a primeira amostra com CPU calculada.
  const deadline = Date.now() + Math.max(6000, config.sampleIntervalMs * 4)
  while (Date.now() < deadline) {
    const current = engine.getSnapshot()
    if (current?.processes.some((process) => process.cpuPct != null)) break
    await delay(250)
  }
  const snapshot = engine.getSnapshot() ?? first

  if (args.has('--json')) {
    console.log(JSON.stringify(snapshot, null, 2))
  } else {
    console.log(summarize(snapshot))
  }
  shutdown(0)
}

async function waitForSnapshot(): Promise<Snapshot | null> {
  if (engine.getSnapshot()) return engine.getSnapshot()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      engine.off('snapshot', onSnapshot)
      resolve(engine.getSnapshot())
    }, 12_000)
    function onSnapshot(snapshot: Snapshot): void {
      clearTimeout(timer)
      engine.off('snapshot', onSnapshot)
      resolve(snapshot)
    }
    engine.on('snapshot', onSnapshot)
  })
}

function hold(): void {
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
}

function shutdown(code: number): void {
  engine.stop()
  closeLogger()
  process.exit(code)
}

main().catch((error) => {
  console.error(error)
  shutdown(1)
})
