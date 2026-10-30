import type {
  AuditEntry,
  RuntimeInfo,
  Snapshot,
  TerminateRequest,
  TerminateResult,
  TerminateWorkloadRequest
} from '@shared/types'
import type { VitalsApi } from '@shared/api'

declare global {
  interface Window {
    vitals?: VitalsApi
  }
}

/**
 * No Electron, `window.vitals` vem do preload (IPC).
 * Fora dele (probe --serve / navegador), usamos a API HTTP local.
 */
export function getApi(): VitalsApi {
  if (window.vitals) return window.vitals
  return httpApi
}

const base = ''

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return (await response.json()) as T
}

const httpApi: VitalsApi = {
  getSnapshot: () => getJson<Snapshot>('/api/snapshot'),
  onSnapshot: (listener) => {
    const source = new EventSource('/api/events')
    source.onmessage = (event) => {
      try {
        listener(JSON.parse(event.data) as Snapshot)
      } catch {
        // ignora payload invalido
      }
    }
    return () => source.close()
  },
  terminate: async (request: TerminateRequest) => {
    const response = await fetch('/api/terminate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    })
    return (await response.json()) as TerminateResult
  },
  terminateWorkload: async (request: TerminateWorkloadRequest) => {
    const response = await fetch('/api/terminate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    })
    return (await response.json()) as TerminateResult
  },
  getAudit: (limit = 50) => getJson<AuditEntry[]>(`/api/audit?limit=${limit}`),
  getRuntime: () => getJson<RuntimeInfo>('/api/runtime')
}
