import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron'
import type {
  AuditEntry,
  RuntimeInfo,
  Snapshot,
  TerminateRequest,
  TerminateWorkloadRequest
} from '@shared/types'
import { formatPct } from '@shared/format'
import { IPC } from '@shared/ipc'
import { loadConfig, loadDotEnv } from './config'
import { initLogger, closeLogger, log } from './logger'
import { TelemetryEngine } from './telemetry/engine'
import { ActionService } from './actions/terminate'
import { VitalsHttpServer } from './http/server'

loadDotEnv()
const config = loadConfig()
initLogger(config.logDir)

const engine = new TelemetryEngine({
  intervalMs: config.sampleIntervalMs,
  historyPoints: config.historyPoints,
  portsIntervalMs: config.portsIntervalMs,
  getSelfPids: () => app.getAppMetrics().map((metric) => metric.pid)
})

const actions = new ActionService(engine, config)
const rendererDir = join(__dirname, '../renderer')
const httpServer = new VitalsHttpServer({
  config,
  engine,
  actions,
  staticDir: rendererDir,
  runtime: buildRuntime
})

let window: BrowserWindow | null = null
let httpUrl: string | null = null
let tray: Tray | null = null
let isQuitting = false
let lastTrayKey = ''
let lastTrayAt = 0

const HEALTH_LABEL: Record<string, string> = {
  ok: 'OK',
  warn: 'ATENCAO',
  critical: 'CRITICO',
  unknown: 'SEM DADOS'
}

function buildRuntime(): RuntimeInfo {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'dev',
    nodeVersion: process.versions.node,
    schema: 2,
    sampleIntervalMs: config.sampleIntervalMs,
    historyPoints: config.historyPoints,
    actionsEnabled: config.actions.enabled,
    logDir: config.logDir,
    http: {
      enabled: config.http.enabled,
      url: httpUrl,
      tokenRequired: config.http.token !== ''
    },
    platform: process.platform
  }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#07090c',
    autoHideMenuBar: true,
    title: 'Vitals',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window?.show())
  window.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault()
      window?.hide()
      log.info('window', 'minimizada para a bandeja')
    }
  })
  window.on('closed', () => {
    window = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(rendererDir, 'index.html'))
  }
}

function showWindow(): void {
  if (!window || window.isDestroyed()) {
    if (!isQuitting) createWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) log.info('window', 'restaurada da bandeja')
  window.show()
  window.focus()
}

function toggleWindow(): void {
  if (window && !window.isDestroyed() && window.isVisible()) window.hide()
  else showWindow()
}

function trayIconPath(): string | null {
  const candidates = [
    join(__dirname, 'tray.png'),
    join(process.cwd(), 'build', 'tray.png'),
    join(__dirname, '..', '..', 'build', 'tray.png')
  ]
  return candidates.find((file) => existsSync(file)) ?? null
}

function buildTrayMenu(): void {
  if (!tray) return
  const snapshot = engine.getSnapshot()
  const status = snapshot?.health.status ?? 'unknown'
  const label = HEALTH_LABEL[status] ?? status
  const reason = snapshot?.health.reasons[0]
  const template: MenuItemConstructorOptions[] = [
    { label: 'Abrir Vitals', click: showWindow },
    { label: `Saude: ${label}`, enabled: false }
  ]

  if (reason) template.push({ label: reason.slice(0, 90), enabled: false })
  if (snapshot) {
    template.push({
      label: `RAM ${formatPct(snapshot.memory.usagePct)} · commit ${formatPct(
        snapshot.memory.commitPct ?? 0
      )}`,
      enabled: false
    })
    const primary = snapshot.gpus.find((gpu) => gpu.id === snapshot.primaryGpuId)
    if (primary) {
      template.push({
        label: `GPU ${formatPct(primary.utilPct)} · ${
          primary.tempC != null ? `${Math.round(primary.tempC)} C` : '--'
        }`,
        enabled: false
      })
    }
  }

  template.push(
    { type: 'separator' },
    { label: 'Abrir pasta de logs', click: () => void shell.openPath(config.logDir) },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  )

  tray.setContextMenu(Menu.buildFromTemplate(template))
  const tooltip = [`Vitals · ${label}`]
  if (snapshot) tooltip.push(`commit ${formatPct(snapshot.memory.commitPct ?? 0)}`)
  if (reason) tooltip.push(reason)
  tray.setToolTip(tooltip.join(' · ').slice(0, 120))
}

function createTray(): void {
  if (!config.tray) return
  const iconFile = trayIconPath()
  if (!iconFile) {
    log.warn('tray', 'tray.png nao encontrado; bandeja desabilitada')
    return
  }
  try {
    const image = nativeImage.createFromPath(iconFile)
    if (image.isEmpty()) {
      log.warn('tray', `icone invalido: ${iconFile}`)
      return
    }
    tray = new Tray(image.resize({ width: 16, height: 16 }))
    tray.on('click', toggleWindow)
    tray.on('double-click', showWindow)
    buildTrayMenu()
    log.info('tray', 'icone criado')
  } catch (error) {
    log.warn('tray', 'falha ao criar bandeja', error instanceof Error ? error.message : error)
    tray = null
  }
}

function updateTray(snapshot: Snapshot): void {
  if (!tray) return
  const key = `${snapshot.health.status}|${snapshot.health.reasons[0] ?? ''}|${Math.round(
    snapshot.memory.commitPct ?? 0
  )}`
  const now = Date.now()
  if (key === lastTrayKey && now - lastTrayAt < 15_000) return
  lastTrayKey = key
  lastTrayAt = now
  buildTrayMenu()
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSnapshot, (): Snapshot | null => engine.getSnapshot())
  ipcMain.handle(IPC.getRuntime, (): RuntimeInfo => buildRuntime())
  ipcMain.handle(IPC.getAudit, (_event, limit?: number): AuditEntry[] => actions.getAudit(limit))
  ipcMain.handle(IPC.terminate, (_event, request: TerminateRequest) =>
    actions.terminate(request, 'ui')
  )
  ipcMain.handle(IPC.terminateWorkload, (_event, request: TerminateWorkloadRequest) =>
    actions.terminateWorkload(request, 'ui')
  )
}

function broadcast(snapshot: Snapshot): void {
  updateTray(snapshot)
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send(IPC.snapshot, snapshot)
  } catch {
    // janela pode estar fechando
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })

  app.whenReady().then(async () => {
    registerIpc()
    engine.on('snapshot', broadcast)

    try {
      await engine.start()
    } catch (error) {
      log.error('app', 'engine falhou ao iniciar', error)
    }

    if (config.http.enabled) {
      httpUrl = httpServer.start()
    }

    createWindow()
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Com bandeja, a janela so e escondida; o app continua monitorando.
    if (!tray || isQuitting) app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    tray?.destroy()
    tray = null
    httpServer.stop()
    engine.stop()
    closeLogger()
  })
}

process.on('uncaughtException', (error) => log.error('app', 'uncaughtException', error))
process.on('unhandledRejection', (error) => log.error('app', 'unhandledRejection', error))
