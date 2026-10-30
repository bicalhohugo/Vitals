import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type {
  AuditEntry,
  RuntimeInfo,
  Snapshot,
  TerminateRequest,
  TerminateWorkloadRequest
} from '@shared/types'
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
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    httpServer.stop()
    engine.stop()
    closeLogger()
  })
}

process.on('uncaughtException', (error) => log.error('app', 'uncaughtException', error))
process.on('unhandledRejection', (error) => log.error('app', 'unhandledRejection', error))
