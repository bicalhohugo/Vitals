import type { ProcessRow, Workload } from '@shared/types'
import { isContainerName, isSystemHostName, matchWorkloadRule } from '@shared/workloads'

export interface BuildWorkloadsResult {
  workloads: Workload[]
  /** pid -> workloadId. Processos de sistema/protegidos ficam de fora. */
  byPid: Map<number, string>
}

/**
 * Agrupa processos em workloads usando a arvore (ppid).
 *
 * Ancora = subir pelos pais ate o processo cujo pai e um "container" do sistema
 * (explorer, services, cmd, pwsh, conhost...) ou desconhecido. Assim
 * `uv -> jarvis -> python` vira um workload so, e nao se mistura com o
 * terminal que o iniciou.
 *
 * Processos protegidos nao geram workload: viram `null` e nunca sao ejetaveis.
 */
export function buildWorkloads(
  rows: ProcessRow[],
  portsOf: (pid: number) => number[],
  selfPids: Set<number>
): BuildWorkloadsResult {
  const rowByPid = new Map<number, ProcessRow>()
  for (const row of rows) rowByPid.set(row.pid, row)

  const anchorCache = new Map<number, { pid: number; systemHosted: boolean }>()
  const anchorOf = (row: ProcessRow): { pid: number; systemHosted: boolean } => {
    const cached = anchorCache.get(row.pid)
    if (cached) return cached

    let current = row
    let systemHosted = false
    const seen = new Set<number>()
    while (true) {
      if (seen.has(current.pid)) break
      seen.add(current.pid)
      const parent = current.ppid != null ? rowByPid.get(current.ppid) : undefined
      if (!parent) break
      if (isContainerName(parent.name)) {
        if (isSystemHostName(parent.name)) systemHosted = true
        break
      }
      current = parent
    }
    const result = { pid: current.pid, systemHosted }
    anchorCache.set(row.pid, result)
    return result
  }

  const groups = new Map<number, ProcessRow[]>()
  for (const row of rows) {
    if (row.isProtected || row.isSelf) continue
    const anchor = anchorOf(row)
    if (anchor.systemHosted) continue
    const group = groups.get(anchor.pid)
    if (group) group.push(row)
    else groups.set(anchor.pid, [row])
  }

  const byPid = new Map<number, string>()
  const workloads: Workload[] = []

  for (const [anchorPid, members] of groups) {
    const root = rowByPid.get(anchorPid)
    if (!root) continue

    const rule = pickRule(members)
    const ports = new Set<number>()
    let cpuPct = 0
    let rssBytes = 0
    let privateBytes = 0
    let vramMiB = 0
    let sharedVramMiB = 0
    let gpuUtilPct = 0
    let startedAt: number | null = null
    const adapters = new Set<string>()

    for (const member of members) {
      cpuPct += member.cpuPct ?? 0
      rssBytes += member.rssBytes
      privateBytes += member.privateBytes
      vramMiB += member.vramMiB
      sharedVramMiB += member.sharedVramMiB
      gpuUtilPct = Math.max(gpuUtilPct, member.gpuUtilPct ?? 0)
      for (const adapter of member.gpuAdapters) adapters.add(adapter)
      for (const port of portsOf(member.pid)) ports.add(port)
      if (member.startedAt != null) {
        startedAt = startedAt == null ? member.startedAt : Math.min(startedAt, member.startedAt)
      }
    }

    const id = `wl:${anchorPid}`
    workloads.push({
      id,
      label: rule?.label ?? root.name,
      kind: rule?.kind ?? 'app',
      rootPid: anchorPid,
      pids: members.map((member) => member.pid),
      processCount: members.length,
      ports: [...ports].sort((a, b) => a - b),
      cpuPct: Math.min(100, cpuPct),
      rssBytes,
      privateBytes,
      vramMiB,
      sharedVramMiB,
      gpuUtilPct,
      adapters: [...adapters],
      startedAt,
      isProtected: root.isProtected || members.some((member) => selfPids.has(member.pid)),
      isSelf: members.some((member) => selfPids.has(member.pid))
    })

    for (const member of members) byPid.set(member.pid, id)
  }

  // Desambigua rotulos repetidos (ex.: duas instancias do Chrome).
  const counts = new Map<string, number>()
  for (const workload of workloads) {
    counts.set(workload.label, (counts.get(workload.label) ?? 0) + 1)
  }
  for (const workload of workloads) {
    if ((counts.get(workload.label) ?? 0) > 1) {
      workload.label = `${workload.label} (${workload.rootPid})`
    }
  }

  // Ordena pelo que aperta a maquina: VRAM primeiro, depois commit privado.
  workloads.sort((a, b) => b.vramMiB - a.vramMiB || b.privateBytes - a.privateBytes)
  return { workloads, byPid }
}

function pickRule(members: ProcessRow[]) {
  for (const member of members) {
    const rule = matchWorkloadRule({ name: member.name, path: member.path })
    if (rule) return rule
  }
  return null
}
