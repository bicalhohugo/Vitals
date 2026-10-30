import { useCallback, useEffect, useState } from 'react'
import type { AuditEntry, RuntimeInfo, Snapshot } from '@shared/types'
import { getApi } from '../api'

export interface VitalsState {
  snapshot: Snapshot | null
  runtime: RuntimeInfo | null
  audit: AuditEntry[]
  error: string | null
  refreshAudit: () => void
}

export function useVitals(): VitalsState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const refreshAudit = useCallback(() => {
    getApi()
      .getAudit(30)
      .then(setAudit)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const api = getApi()
    let alive = true

    api
      .getRuntime()
      .then((value) => {
        if (alive) setRuntime(value)
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })

    api
      .getSnapshot()
      .then((value) => {
        if (alive && value) setSnapshot(value)
      })
      .catch(() => undefined)

    const unsubscribe = api.onSnapshot((value) => {
      setSnapshot(value)
      setError(null)
    })

    refreshAudit()
    const timer = window.setInterval(refreshAudit, 6000)

    return () => {
      alive = false
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [refreshAudit])

  return { snapshot, runtime, audit, error, refreshAudit }
}
