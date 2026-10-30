import type {
  PolicyDecision,
  Snapshot,
  TerminateRequest,
  TerminateWorkloadRequest
} from '@shared/types'

/**
 * Decide se uma ejeccao e permitida. Nao executa nada: e pura e testavel.
 *
 * Negar e o padrao. Toda excecao precisa de motivo explicito e de um teste em
 * tests/policy.test.ts.
 */
export function planProcessTermination(
  snapshot: Snapshot,
  request: TerminateRequest,
  actionsEnabled: boolean
): PolicyDecision {
  const base = {
    requiresElevation: false,
    isProtected: false,
    pids: [] as number[]
  }

  if (!actionsEnabled) {
    return { ...base, allowed: false, reason: 'Acoes desabilitadas (VITALS_ACTIONS=0)', label: `pid ${request.pid}` }
  }

  if (!Number.isInteger(request.pid) || request.pid <= 4) {
    return { ...base, allowed: false, reason: 'PID de kernel ou invalido', label: `pid ${request.pid}` }
  }

  const row = snapshot.processes.find((process) => process.pid === request.pid)
  if (!row) {
    return { ...base, allowed: false, reason: 'Processo nao encontrado na amostra atual', label: `pid ${request.pid}` }
  }

  if (row.isSelf) {
    return { ...base, allowed: false, reason: 'O Vitals nao encerra a si mesmo', label: row.name, isProtected: true }
  }

  if (row.isProtected) {
    return { ...base, allowed: false, reason: `Processo protegido: ${row.name}`, label: row.name, isProtected: true }
  }

  if (
    request.expectedStartedAt != null &&
    row.startedAt != null &&
    request.expectedStartedAt !== row.startedAt
  ) {
    return {
      ...base,
      allowed: false,
      reason: 'O PID foi reutilizado por outro processo desde a amostra; recarregue o HUD',
      label: row.name
    }
  }

  return { ...base, allowed: true, reason: null, label: row.name, pids: [row.pid] }
}

export function planWorkloadTermination(
  snapshot: Snapshot,
  request: TerminateWorkloadRequest,
  actionsEnabled: boolean
): PolicyDecision {
  const base = {
    requiresElevation: false,
    isProtected: false,
    pids: [] as number[]
  }

  if (!actionsEnabled) {
    return {
      ...base,
      allowed: false,
      reason: 'Acoes desabilitadas (VITALS_ACTIONS=0)',
      label: request.workloadId
    }
  }

  const workload = snapshot.workloads.find((entry) => entry.id === request.workloadId)
  if (!workload) {
    return {
      ...base,
      allowed: false,
      reason: 'Workload nao encontrado (pode ter terminado)',
      label: request.workloadId
    }
  }

  if (workload.isSelf) {
    return {
      ...base,
      allowed: false,
      reason: 'O workload contem o proprio Vitals',
      label: workload.label,
      isProtected: true
    }
  }

  const protectedMembers = workload.pids
    .map((pid) => snapshot.processes.find((process) => process.pid === pid))
    .filter((process) => process?.isProtected)

  if (workload.isProtected || protectedMembers.length > 0) {
    const names = protectedMembers.slice(0, 3).map((process) => process?.name).filter(Boolean)
    return {
      ...base,
      allowed: false,
      reason: names.length
        ? `Workload contem processo protegido: ${names.join(', ')}`
        : 'Workload protegido',
      label: workload.label,
      isProtected: true
    }
  }

  if (workload.pids.length === 0) {
    return { ...base, allowed: false, reason: 'Workload sem processos', label: workload.label }
  }

  return {
    ...base,
    allowed: true,
    reason: null,
    label: workload.label,
    pids: [workload.rootPid, ...workload.pids.filter((pid) => pid !== workload.rootPid)]
  }
}
