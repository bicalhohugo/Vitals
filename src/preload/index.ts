import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuditEntry,
  RuntimeInfo,
  Snapshot,
  TerminateRequest,
  TerminateResult,
  TerminateWorkloadRequest
} from '@shared/types'
import type { VitalsApi } from '@shared/api'
import { IPC } from '@shared/ipc'

/**
 * Superficie minima exposta ao renderer. Nada de ipcRenderer cru, nada de fs.
 * Toda acao passa por IPC nomeado e volta a ser validada no main.
 */
const api: VitalsApi = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke(IPC.getSnapshot),
  onSnapshot: (listener: (snapshot: Snapshot) => void): (() => void) => {
    const handler = (_event: unknown, snapshot: Snapshot): void => listener(snapshot)
    ipcRenderer.on(IPC.snapshot, handler)
    return () => ipcRenderer.removeListener(IPC.snapshot, handler)
  },
  terminate: (request: TerminateRequest): Promise<TerminateResult> =>
    ipcRenderer.invoke(IPC.terminate, request),
  terminateWorkload: (request: TerminateWorkloadRequest): Promise<TerminateResult> =>
    ipcRenderer.invoke(IPC.terminateWorkload, request),
  getAudit: (limit?: number): Promise<AuditEntry[]> => ipcRenderer.invoke(IPC.getAudit, limit),
  getRuntime: (): Promise<RuntimeInfo> => ipcRenderer.invoke(IPC.getRuntime)
}

contextBridge.exposeInMainWorld('vitals', api)
