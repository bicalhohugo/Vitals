import type {
  AuditEntry,
  RuntimeInfo,
  Snapshot,
  TerminateRequest,
  TerminateResult,
  TerminateWorkloadRequest
} from './types'

/** Superficie exposta em `window.vitals` pelo preload. */
export interface VitalsApi {
  getSnapshot(): Promise<Snapshot>
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void
  terminate(request: TerminateRequest): Promise<TerminateResult>
  terminateWorkload(request: TerminateWorkloadRequest): Promise<TerminateResult>
  getAudit(limit?: number): Promise<AuditEntry[]>
  getRuntime(): Promise<RuntimeInfo>
}
