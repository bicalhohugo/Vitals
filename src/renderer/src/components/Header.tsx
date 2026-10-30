import type { ReactNode } from 'react'
import type { RuntimeInfo, Snapshot } from '@shared/types'
import { formatDuration } from '@shared/format'
import { Pill } from './ui'

const HEALTH_LABEL = {
  ok: 'saudavel',
  warn: 'atencao',
  critical: 'critico',
  unknown: 'sem dados'
} as const

export function Header({
  snapshot,
  runtime
}: {
  snapshot: Snapshot
  runtime: RuntimeInfo | null
}): ReactNode {
  const ageSec = Math.max(0, Math.round((Date.now() - snapshot.ts) / 1000))
  const healthTone =
    snapshot.health.status === 'critical'
      ? 'crit'
      : snapshot.health.status === 'warn'
        ? 'warn'
        : snapshot.health.status === 'ok'
          ? 'ok'
          : 'neutral'

  const sources = [
    { key: 'sensor', label: 'sensor', state: snapshot.sources.windowsSensor },
    { key: 'nvidia', label: 'nvidia', state: snapshot.sources.nvidia },
    { key: 'portas', label: 'portas', state: snapshot.sources.ports },
    { key: 'discos', label: 'discos', state: snapshot.sources.storage }
  ]

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <div className="brand-name">VITALS</div>
          <div className="brand-sub">saude do servidor</div>
        </div>
      </div>

      <div className="host">
        <strong>{snapshot.host.hostname}</strong>
        <span className="dot-sep">·</span>
        <span>{snapshot.host.cpuModel}</span>
        <span className="dot-sep">·</span>
        <span>
          {snapshot.host.cores}C/{snapshot.host.threads}T
        </span>
        <span className="dot-sep">·</span>
        <span>uptime {formatDuration(snapshot.host.uptimeSec)}</span>
        {snapshot.host.elevated ? (
          <>
            <span className="dot-sep">·</span>
            <Pill tone="violet">admin</Pill>
          </>
        ) : null}
      </div>

      <div className="topbar-right">
        <div className="sources">
          {sources.map((source) => (
            <span
              key={source.key}
              className={`source source-${source.state.status}`}
              title={`${source.label}: ${source.state.status}${source.state.error ? ` - ${source.state.error}` : ''}`}
            >
              <i />
              {source.label}
            </span>
          ))}
        </div>
        <Pill tone={healthTone} title={snapshot.health.reasons.join(' | ')}>
          {HEALTH_LABEL[snapshot.health.status]}
        </Pill>
        <span className={`freshness ${ageSec > 5 ? 'stale' : ''}`}>ha {ageSec}s</span>
        {runtime ? <span className="version">v{runtime.appVersion}</span> : null}
      </div>
    </header>
  )
}
