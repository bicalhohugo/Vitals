import type { ReactNode } from 'react'
import type { AuditEntry, Snapshot } from '@shared/types'
import { formatBytes, formatClock, formatDuration, formatPct } from '@shared/format'
import { Empty, Meter, Pill, SectionTitle, Sparkline } from './ui'

export function Rail({ snapshot, audit }: { snapshot: Snapshot; audit: AuditEntry[] }): ReactNode {
  const { cpu, memory } = snapshot
  const ramTone = memory.usagePct >= 95 ? 'crit' : memory.usagePct >= 88 ? 'warn' : 'accent'
  const commitTone =
    (memory.commitPct ?? 0) >= 94 ? 'crit' : (memory.commitPct ?? 0) >= 85 ? 'warn' : 'violet'

  return (
    <aside className="rail">
      <section className="panel">
        <SectionTitle hint={<span className="mono">{formatPct(cpu.usagePct)}</span>}>CPU</SectionTitle>
        <Sparkline values={snapshot.history.cpu} color="#22d3ee" />
        <div className="cores">
          {cpu.perCorePct.map((value, index) => (
            <div key={index} className="core" title={`core ${index}: ${formatPct(value)}`}>
              <span className="core-bar">
                <i style={{ height: `${Math.max(3, Math.min(100, value))}%` }} />
              </span>
              <span className="core-label mono">{index}</span>
            </div>
          ))}
        </div>
        <div className="kv">
          <div>
            <span className="muted">clock</span>
            <span className="mono">{cpu.speedMhz ? `${cpu.speedMhz.toFixed(0)} MHz` : '--'}</span>
          </div>
          <div>
            <span className="muted">threads</span>
            <span className="mono">{snapshot.host.threads}</span>
          </div>
          <div>
            <span className="muted">uptime app</span>
            <span className="mono">{formatDuration(snapshot.host.appUptimeSec)}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <SectionTitle hint={<span className="mono">{formatPct(memory.usagePct)}</span>}>Memoria</SectionTitle>
        <div className="mem-row">
          <span className="muted">fisica</span>
          <span className="mono">
            {formatBytes(memory.usedBytes)} / {formatBytes(memory.totalBytes)}
          </span>
        </div>
        <Meter value={memory.usagePct} tone={ramTone} height={9} />
        <Sparkline values={snapshot.history.ram} color="#34d399" max={100} />

        <div className="mem-row">
          <span className="muted">commit</span>
          <span className="mono">
            {memory.committedBytes != null ? formatBytes(memory.committedBytes) : '--'}
            {memory.commitPct != null ? <span className="muted"> · {formatPct(memory.commitPct)}</span> : null}
          </span>
        </div>
        <Meter value={memory.commitPct} tone={commitTone} height={9} />
        <div className="tiny muted">
          limite {memory.commitLimitBytes != null ? formatBytes(memory.commitLimitBytes) : '--'} · cache{' '}
          {memory.cacheBytes != null ? formatBytes(memory.cacheBytes) : '--'}
        </div>
      </section>

      <section className="panel">
        <SectionTitle>Volumes</SectionTitle>
        {snapshot.volumes.length === 0 ? (
          <Empty>Sem dados de disco.</Empty>
        ) : (
          snapshot.volumes.map((volume) => (
            <div key={volume.mount} className="volume">
              <div className="row-between tiny">
                <span className="mono">{volume.mount}</span>
                <span className="muted">
                  {formatBytes(volume.freeBytes)} livres · {formatPct(volume.usedPct)}
                </span>
              </div>
              <Meter
                value={volume.usedPct}
                tone={volume.usedPct >= 92 ? 'crit' : volume.usedPct >= 80 ? 'warn' : 'accent'}
                height={5}
              />
            </div>
          ))
        )}
      </section>

      <section className="panel">
        <SectionTitle hint={<span className="muted">auditoria</span>}>Acoes recentes</SectionTitle>
        {audit.length === 0 ? (
          <Empty>Nenhuma acao registrada.</Empty>
        ) : (
          <div className="audit">
            {audit.slice(0, 6).map((entry) => (
              <div key={entry.id} className="audit-row">
                <span
                  className={`audit-dot ${entry.result === 'success' ? 'ok' : entry.result === 'blocked' ? 'warn' : 'crit'}`}
                />
                <div className="audit-main">
                  <div className="audit-title">
                    <span>{entry.targetLabel}</span>
                    <Pill tone={entry.mode === 'force' ? 'crit' : 'neutral'}>{entry.mode}</Pill>
                  </div>
                  <div className="tiny muted">
                    {formatClock(entry.ts)} · {entry.result} · {entry.pids.length} pid(s)
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}
