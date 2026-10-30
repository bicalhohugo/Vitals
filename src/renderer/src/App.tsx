import { useEffect, useState, type ReactNode } from 'react'
import type { TerminateMode } from '@shared/types'
import { getApi } from './api'
import { useVitals } from './hooks/useVitals'
import { Header } from './components/Header'
import { GpuCard } from './components/GpuCard'
import { Workloads } from './components/Workloads'
import { ProcessTable } from './components/ProcessTable'
import { Rail } from './components/Rail'
import { KillDialog, type KillTarget } from './components/KillDialog'
import { SectionTitle } from './components/ui'

interface Toast {
  text: string
  tone: 'ok' | 'warn' | 'crit'
}

export default function App(): ReactNode {
  const { snapshot, runtime, audit, error, refreshAudit } = useVitals()
  const [target, setTarget] = useState<KillTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 7000)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function confirmKill(mode: TerminateMode): Promise<void> {
    if (!target) return
    setBusy(true)
    try {
      const api = getApi()
      const result =
        target.kind === 'workload'
          ? await api.terminateWorkload({ workloadId: target.id, mode })
          : await api.terminate({
              pid: target.pids[0],
              mode,
              expectedStartedAt: target.startedAt ?? null
            })
      setToast({
        text: result.message,
        tone: result.ok ? 'ok' : result.needsForce ? 'warn' : 'crit'
      })
    } catch (cause) {
      setToast({
        text: `Falha ao ejetar: ${cause instanceof Error ? cause.message : String(cause)}`,
        tone: 'crit'
      })
    } finally {
      setBusy(false)
      setTarget(null)
      refreshAudit()
    }
  }

  if (!snapshot) {
    return (
      <div className="splash">
        <div className="brand-mark large" aria-hidden="true" />
        <h1>VITALS</h1>
        <p className="muted">coletando a primeira amostra...</p>
        {error ? <p className="banner crit">{error}</p> : null}
      </div>
    )
  }

  const primary = snapshot.gpus.find((gpu) => gpu.id === snapshot.primaryGpuId) ?? null
  // Software (WARP) so aparece se estiver realmente em uso; senao e ruido.
  const visibleGpus = snapshot.gpus.filter(
    (gpu) => gpu.kind !== 'software' || gpu.utilPct > 0 || gpu.processes.length > 0
  )

  return (
    <div className="app">
      <Header snapshot={snapshot} runtime={runtime} />

      {snapshot.health.reasons.length > 0 ? (
        <div className={`banner-row ${snapshot.health.status}`}>
          {snapshot.health.reasons.map((reason) => (
            <span key={reason} className="banner-chip">
              {reason}
            </span>
          ))}
        </div>
      ) : null}

      <main className="main">
        <div className="col">
          <section className="panel">
            <SectionTitle
              hint={
                <span className="muted">
                  {visibleGpus.length} adaptador(es)
                  {primary ? ` · principal: ${primary.name}` : ''}
                </span>
              }
            >
              GPU
            </SectionTitle>
            {visibleGpus.length === 0 ? (
              <div className="empty">Nenhum adaptador de GPU detectado.</div>
            ) : (
              <div className="gpu-grid">
                {visibleGpus.map((gpu) => (
                  <GpuCard
                    key={gpu.id}
                    gpu={gpu}
                    processes={snapshot.processes}
                    onKill={setTarget}
                  />
                ))}
              </div>
            )}
          </section>

          <Workloads snapshot={snapshot} onKill={setTarget} />
          <ProcessTable snapshot={snapshot} onKill={setTarget} />
        </div>

        <Rail snapshot={snapshot} audit={audit} />
      </main>

      {target ? (
        <KillDialog
          target={target}
          actionsEnabled={runtime?.actionsEnabled ?? true}
          busy={busy}
          onCancel={() => setTarget(null)}
          onConfirm={confirmKill}
        />
      ) : null}

      {toast ? (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.text}
        </div>
      ) : null}
    </div>
  )
}
