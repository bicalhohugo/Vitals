import type { ReactNode } from 'react'
import type { GpuAdapter, ProcessRow } from '@shared/types'
import { formatMiB, formatPct, formatTemp, formatWatts } from '@shared/format'
import { Meter, Pill } from './ui'
import type { KillTarget } from './KillDialog'

const KIND_LABEL: Record<string, string> = {
  discrete: 'dedicada',
  integrated: 'integrada',
  software: 'software'
}

export function GpuCard({
  gpu,
  processes,
  onKill
}: {
  gpu: GpuAdapter
  processes: ProcessRow[]
  onKill: (target: KillTarget) => void
}): ReactNode {
  const byPid = new Map(processes.map((process) => [process.pid, process]))
  const usedPct = gpu.vramTotalMiB > 0 ? (gpu.vramUsedMiB / gpu.vramTotalMiB) * 100 : 0
  const tone = usedPct >= 97 ? 'crit' : usedPct >= 90 ? 'warn' : 'accent'
  const software = gpu.kind === 'software'
  const top = gpu.processes.filter((entry) => entry.vramMiB > 0 || entry.utilPct > 0).slice(0, 5)
  const engines = Object.entries(gpu.utilByEngine).filter(([, value]) => value > 0)

  return (
    <article className={`gpu ${software ? 'gpu-software' : ''}`}>
      <div className="gpu-head">
        <div>
          <h3>{gpu.name}</h3>
          <div className="gpu-sub">
            <Pill tone={gpu.kind === 'discrete' ? 'accent' : 'neutral'}>
              {KIND_LABEL[gpu.kind] ?? gpu.kind}
            </Pill>
            <Pill tone={gpu.telemetry === 'nvidia-smi' ? 'ok' : 'neutral'}>{gpu.telemetry}</Pill>
            {gpu.driver ? <span className="muted">driver {gpu.driver}</span> : null}
          </div>
        </div>
        <div className="gpu-util">
          <span className="big">{formatPct(gpu.utilPct)}</span>
          <span className="muted">uso</span>
        </div>
      </div>

      <div className="gpu-vram">
        <div className="row-between">
          <span className="label">VRAM</span>
          <span className="mono">
            {formatMiB(gpu.vramUsedMiB)} / {formatMiB(gpu.vramTotalMiB)}
            <span className="muted"> · {formatPct(usedPct)}</span>
          </span>
        </div>
        <Meter value={usedPct} tone={tone} height={10} />
        {gpu.sharedUsedMiB > 0 ? (
          <div className="row-between tiny">
            <span className="muted">compartilhada</span>
            <span className="mono muted">{formatMiB(gpu.sharedUsedMiB)}</span>
          </div>
        ) : null}
      </div>

      <div className="stats">
        <Stat label="temperatura" value={formatTemp(gpu.tempC)} tone={gpu.tempC != null && gpu.tempC >= 83 ? 'warn' : undefined} />
        <Stat label="potencia" value={formatWatts(gpu.powerW)} />
        <Stat label="limite" value={formatWatts(gpu.powerLimitW)} />
        <Stat label="fan" value={gpu.fanPct != null ? `${Math.round(gpu.fanPct)}%` : '--'} />
        <Stat label="clock" value={gpu.clockSmMhz != null ? `${gpu.clockSmMhz} MHz` : '--'} />
        <Stat label="mem clock" value={gpu.clockMemMhz != null ? `${gpu.clockMemMhz} MHz` : '--'} />
      </div>

      {engines.length > 0 ? (
        <div className="engines">
          {engines.map(([name, value]) => (
            <span key={name} className="engine">
              {name} <b>{formatPct(value)}</b>
            </span>
          ))}
        </div>
      ) : null}

      {!software ? (
        <div className="gpu-procs">
          <div className="row-between tiny">
            <span className="muted">processos nesta GPU</span>
            <span className="muted">{gpu.processes.length}</span>
          </div>
          {top.length === 0 ? (
            <div className="empty small">nenhum processo consumindo agora</div>
          ) : (
            top.map((entry) => {
              const row = byPid.get(entry.pid)
              const name = row?.name ?? `pid ${entry.pid}`
              const protectedRow = row?.isProtected ?? false
              return (
                <div key={`${entry.adapterId}-${entry.pid}`} className="proc-row">
                  <div className="proc-name" title={row?.path ?? name}>
                    <span>{name}</span>
                    <span className="muted mono">#{entry.pid}</span>
                  </div>
                  <div className="proc-metrics mono">
                    <span>{formatMiB(entry.vramMiB)}</span>
                    <span className="muted">{formatPct(entry.utilPct)}</span>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!row || protectedRow}
                    title={protectedRow ? 'processo protegido' : 'ejetar processo'}
                    onClick={() =>
                      row &&
                      onKill({
                        kind: 'process',
                        id: String(row.pid),
                        label: row.name,
                        pids: [row.pid],
                        startedAt: row.startedAt
                      })
                    }
                  >
                    ejetar
                  </button>
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </article>
  )
}

function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'warn' | 'crit'
}): ReactNode {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value mono">{value}</span>
    </div>
  )
}
