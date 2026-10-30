import { useEffect, useState, type ReactNode } from 'react'
import type { TerminateMode } from '@shared/types'

export interface KillTarget {
  kind: 'process' | 'workload'
  id: string
  label: string
  pids: number[]
  startedAt?: number | null
}

const PHRASE = 'EJETAR'

export function KillDialog({
  target,
  actionsEnabled,
  busy,
  onCancel,
  onConfirm
}: {
  target: KillTarget
  actionsEnabled: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: (mode: TerminateMode) => void
}): ReactNode {
  const [force, setForce] = useState(false)
  const [phrase, setPhrase] = useState('')

  useEffect(() => {
    setForce(false)
    setPhrase('')
  }, [target.id])

  const canConfirm = actionsEnabled && !busy && phrase.trim().toUpperCase() === PHRASE

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h2>Ejetar {target.kind === 'workload' ? 'workload' : 'processo'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            fechar
          </button>
        </div>

        <div className="dialog-body">
          <div className="dialog-target">
            <strong>{target.label}</strong>
            <span className="muted mono">
              {target.kind === 'workload' ? `${target.pids.length} processo(s)` : `pid ${target.pids[0]}`}
            </span>
          </div>

          {target.pids.length > 1 ? (
            <div className="dialog-pids mono">
              {target.pids.slice(0, 10).map((pid) => (
                <span key={pid} className="pid-chip">
                  #{pid}
                </span>
              ))}
              {target.pids.length > 10 ? <span className="muted">+{target.pids.length - 10}</span> : null}
            </div>
          ) : null}

          <p className="dialog-warning">
            Isso pede o fechamento dos processos agora. Trabalho nao salvo pode ser perdido. O Vitals pede
            primeiro um encerramento gracioso; use <b>forcar</b> apenas se o processo ignorar o pedido.
          </p>

          {!actionsEnabled ? (
            <div className="banner warn">
              Acoes estao desabilitadas (<span className="mono">VITALS_ACTIONS=0</span>).
            </div>
          ) : null}

          <label className="check">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
              disabled={busy}
            />
            <span>
              Forcar encerramento (<span className="mono">taskkill /F</span>)
            </span>
          </label>

          {force ? (
            <div className="banner warn">
              Force nao da chance de salvar. Prefira o modo gracioso quando possivel.
            </div>
          ) : null}

          <label className="field">
            <span>
              Digite <b className="mono">{PHRASE}</b> para confirmar
            </span>
            <input
              autoFocus
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={PHRASE}
              disabled={busy}
            />
          </label>
        </div>

        <div className="dialog-foot">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            cancelar
          </button>
          <button
            className={`btn ${force ? 'btn-danger' : 'btn-primary'}`}
            disabled={!canConfirm}
            onClick={() => onConfirm(force ? 'force' : 'graceful')}
          >
            {busy ? 'ejetando...' : force ? 'forcar agora' : 'ejetar'}
          </button>
        </div>
      </div>
    </div>
  )
}
