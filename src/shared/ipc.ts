/** Canais IPC. Nomes congelados: sao contrato entre preload e main. */
export const IPC = {
  snapshot: 'vitals:snapshot',
  getSnapshot: 'vitals:get-snapshot',
  terminate: 'vitals:terminate',
  terminateWorkload: 'vitals:terminate-workload',
  getAudit: 'vitals:get-audit',
  getRuntime: 'vitals:get-runtime'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
