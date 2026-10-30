import { useMemo, useState, type ReactNode } from 'react'
import type { Snapshot } from '@shared/types'
import { formatBytes, formatDuration, formatMiB, formatPct } from '@shared/format'
import { Empty, Meter, Pill, SectionTitle } from './ui'
import type { KillTarget } from './KillDialog'

const KIND_TONE: Record<string, 'accent' | 'violet' | 'warn' | 'neutral' | 'ok'> = {
  ai: 'violet',
  dev: 'accent',
  desktop: 'neutral',
  app: 'neutral'
}

export function Workloads({
  snapshot,
  onKill
}: {
  snapshot: Snapshot
  onKill: (target: KillTarget) => void
}): ReactNode {
  const [showAll, setShowAll] = useState(false)
  const primaryVram = snapshot.gpus.find((gpu) => gpu.id === snapshot.primaryGpuId)?.vramTotalMiB ?? 0
  // Commit e o numero honesto no Windows: um processo pode ter 17 GB privados
  // com working set de 14 MB (memoria paginada/trimmed). RSS engana.
  const commitTotal = snapshot.memory.commitLimitBytes ?? snapshot.memory.totalBytes
  const workloads = useMemo(() => {
    const list = showAll
      ? snapshot.workloads
      : snapshot.workloads.filter(
          (item) => item.vramMiB > 0 || item.privateBytes > 300 * 1024 * 1024 || item.ports.length > 0
        )
    return list.slice(0, showAll ? 40 : 8)
  }, [snapshot.workloads, showAll])

  return (
    <section className="panel">
      <SectionTitle
        hint={
          <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'so os relevantes' : `ver todos (${snapshot.workloads.length})`}
          </button>
        }
      >
        Workloads
      </SectionTitle>

      {workloads.length === 0 ? (
        <Empty>Nenhum workload relevante no momento.</Empty>
      ) : (
        <div className="workloads">
          {workloads.map((workload) => (
            <div key={workload.id} className="workload">
              <div className="workload-main">
                <div className="workload-title">
                  <span className="workload-name">{workload.label}</span>
                  <Pill tone={KIND_TONE[workload.kind] ?? 'neutral'}>{workload.kind}</Pill>
                  {workload.ports.length > 0 ? (
                    <span className="ports mono">:{workload.ports.join(' :')}</span>
                  ) : null}
                </div>
                <div className="workload-meta muted">
                  <span className="mono">raiz #{workload.rootPid}</span>
                  <span>·</span>
                  <span>{workload.processCount} processo(s)</span>
                  {workload.startedAt ? (
                    <>
                      <span>·</span>
                      <span>ha {formatDuration((snapshot.ts - workload.startedAt) / 1000)}</span>
                    </>
                  ) : null}
                </div>
                <div className="workload-bars">
                  <div className="workload-bar">
                    <span className="muted tiny">VRAM {formatMiB(workload.vramMiB)}</span>
                    <Meter
                      value={primaryVram > 0 ? (workload.vramMiB / primaryVram) * 100 : 0}
                      tone="violet"
                      height={5}
                    />
                  </div>
                  <div className="workload-bar">
                    <span className="muted tiny">commit {formatBytes(workload.privateBytes)}</span>
                    <Meter
                      value={(workload.privateBytes / Math.max(1, commitTotal)) * 100}
                      tone="accent"
                      height={5}
                    />
                  </div>
                </div>
              </div>

              <div className="workload-numbers mono">
                <span title="VRAM dedicada">{formatMiB(workload.vramMiB)}</span>
                <span title={`Commit privado; residente ${formatBytes(workload.rssBytes)}`}>
                  {formatBytes(workload.privateBytes)}
                </span>
                <span title="CPU" className="muted">
                  {formatPct(workload.cpuPct)}
                </span>
              </div>

              <button
                className="btn btn-danger btn-sm"
                disabled={workload.isProtected}
                title={
                  workload.isProtected
                    ? 'workload protegido'
                    : `ejetar ${workload.label} (${workload.processCount} processos)`
                }
                onClick={() =>
                  onKill({
                    kind: 'workload',
                    id: workload.id,
                    label: workload.label,
                    pids: workload.pids,
                    startedAt: workload.startedAt
                  })
                }
              >
                ejetar
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
