import { useMemo, useState, type ReactNode } from 'react'
import type { Snapshot } from '@shared/types'
import { formatBytes, formatMiB, formatPct } from '@shared/format'
import { Empty, Pill, SectionTitle } from './ui'
import type { KillTarget } from './KillDialog'

type SortKey = 'vram' | 'ram' | 'cpu' | 'gpu'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'vram', label: 'GPU VRAM' },
  { key: 'ram', label: 'RAM' },
  { key: 'cpu', label: 'CPU' },
  { key: 'gpu', label: 'GPU %' }
]

export function ProcessTable({
  snapshot,
  onKill
}: {
  snapshot: Snapshot
  onKill: (target: KillTarget) => void
}): ReactNode {
  const [sort, setSort] = useState<SortKey>('vram')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(40)

  const workloadLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const workload of snapshot.workloads) map.set(workload.id, workload.label)
    return map
  }, [snapshot.workloads])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? snapshot.processes.filter(
          (process) =>
            process.name.toLowerCase().includes(needle) ||
            String(process.pid) === needle ||
            (process.path ?? '').toLowerCase().includes(needle)
        )
      : snapshot.processes

    const score = (process: Snapshot['processes'][number]): number => {
      switch (sort) {
        case 'vram':
          return process.vramMiB
        case 'ram':
          return process.privateBytes
        case 'cpu':
          return process.cpuPct ?? 0
        case 'gpu':
          return process.gpuUtilPct ?? 0
      }
    }

    return [...filtered].sort((a, b) => score(b) - score(a)).slice(0, limit)
  }, [snapshot.processes, query, sort, limit])

  return (
    <section className="panel">
      <SectionTitle hint={<span className="muted">{snapshot.processes.length} processos</span>}>
        Consumidores
      </SectionTitle>

      <div className="table-tools">
        <div className="tabs">
          {SORTS.map((option) => (
            <button
              key={option.key}
              className={`tab ${sort === option.key ? 'active' : ''}`}
              onClick={() => setSort(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="filtrar por nome, pid ou caminho"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <Empty>Nada encontrado.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>processo</th>
                <th>workload</th>
                <th className="num">cpu</th>
                <th className="num">commit</th>
                <th className="num">vram</th>
                <th className="num">gpu</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((process) => (
                <tr key={process.pid} className={process.isProtected ? 'protected' : ''}>
                  <td>
                    <div className="proc-cell" title={process.path ?? process.name}>
                      <span className="proc-title">{process.name}</span>
                      <span className="muted mono">#{process.pid}</span>
                      {process.isSelf ? <Pill tone="violet">vitals</Pill> : null}
                    </div>
                  </td>
                  <td className="muted">
                    {process.workloadId ? (workloadLabel.get(process.workloadId) ?? '—') : '—'}
                  </td>
                  <td className="num mono">{formatPct(process.cpuPct, 1)}</td>
                  <td className="num mono" title={`residente ${formatBytes(process.rssBytes)}`}>
                    {formatBytes(process.privateBytes)}
                  </td>
                  <td className="num mono">
                    {process.vramMiB > 0 ? formatMiB(process.vramMiB) : '—'}
                  </td>
                  <td className="num mono muted">
                    {process.gpuUtilPct != null ? formatPct(process.gpuUtilPct) : '—'}
                  </td>
                  <td className="right">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={process.isProtected}
                      title={process.isProtected ? 'processo protegido' : 'ejetar processo'}
                      onClick={() =>
                        onKill({
                          kind: 'process',
                          id: String(process.pid),
                          label: process.name,
                          pids: [process.pid],
                          startedAt: process.startedAt
                        })
                      }
                    >
                      ejetar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length >= limit ? (
        <button className="btn btn-ghost more" onClick={() => setLimit((value) => value + 60)}>
          mostrar mais
        </button>
      ) : null}
    </section>
  )
}
