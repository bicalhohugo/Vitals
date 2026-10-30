import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  AuditEntry,
  Snapshot,
  TerminateMode,
  TerminateRequest,
  TerminateResult,
  TerminateWorkloadRequest
} from '@shared/types'
import type { AppConfig } from '../config'
import { log } from '../logger'
import type { TelemetryEngine } from '../telemetry/engine'
import { AuditLog, newAuditId } from './audit'
import { planProcessTermination, planWorkloadTermination } from './policy'

const execFileAsync = promisify(execFile)

type Origin = 'ui' | 'api' | 'cli'

/** Erro de "acesso negado" do taskkill: significa que falta elevacao. */
function deniedMessage(message: string): boolean {
  return /acesso negado|access is denied|access denied|\b5\b/i.test(message)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForExit(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs
  let alive = pids.filter(isAlive)
  while (alive.length > 0 && Date.now() < deadline) {
    await delay(100)
    alive = alive.filter(isAlive)
  }
  return alive
}

/**
 * Executa as acoes destrutivas. A UI e a API HTTP chamam este servico; nada
 * mais no projeto derruba processos.
 *
 * Regras:
 *  - toda decisao passa por policy.ts (nunca matar protegido/self/kernel);
 *  - graceful primeiro, force so quando pedido ou quando o graceful falhou;
 *  - verifica o resultado e registra auditoria, inclusive bloqueios.
 */
export class ActionService {
  private readonly audit: AuditLog
  private inFlight = new Set<number>()

  constructor(
    private readonly engine: TelemetryEngine,
    private readonly config: AppConfig
  ) {
    this.audit = new AuditLog(config.logDir)
  }

  getAudit(limit = 50): AuditEntry[] {
    return this.audit.recent(limit)
  }

  async terminate(request: TerminateRequest, origin: Origin): Promise<TerminateResult> {
    const started = Date.now()
    const snapshot = this.engine.getSnapshot()
    const mode: TerminateMode = request.mode === 'force' ? 'force' : 'graceful'
    const auditId = newAuditId()

    if (!snapshot) {
      return this.blockedResult(request.pid, `pid ${request.pid}`, mode, 'Amostra ainda nao disponivel', auditId, started, origin, 'process')
    }

    const plan = planProcessTermination(snapshot, request, this.config.actions.enabled)
    if (!plan.allowed) {
      return this.blockedResult(request.pid, plan.label, mode, plan.reason ?? 'Bloqueado', auditId, started, origin, 'process')
    }

    const result = await this.run({
      mode,
      targetKind: 'process',
      targetId: String(request.pid),
      targetLabel: plan.label,
      pids: plan.pids,
      snapshot,
      auditId,
      started
    })

    this.audit.append(toAuditEntry(result, origin))
    return result
  }

  async terminateWorkload(
    request: TerminateWorkloadRequest,
    origin: Origin
  ): Promise<TerminateResult> {
    const started = Date.now()
    const snapshot = this.engine.getSnapshot()
    const mode: TerminateMode = request.mode === 'force' ? 'force' : 'graceful'
    const auditId = newAuditId()

    if (!snapshot) {
      return this.blockedResult(0, request.workloadId, mode, 'Amostra ainda nao disponivel', auditId, started, origin, 'workload')
    }

    const plan = planWorkloadTermination(snapshot, request, this.config.actions.enabled)
    if (!plan.allowed) {
      return this.blockedResult(0, plan.label, mode, plan.reason ?? 'Bloqueado', auditId, started, origin, 'workload')
    }

    const result = await this.run({
      mode,
      targetKind: 'workload',
      targetId: request.workloadId,
      targetLabel: plan.label,
      pids: plan.pids,
      snapshot,
      auditId,
      started
    })

    this.audit.append(toAuditEntry(result, origin))
    return result
  }

  private async run(input: {
    mode: TerminateMode
    targetKind: 'process' | 'workload'
    targetId: string
    targetLabel: string
    pids: number[]
    snapshot: Snapshot
    auditId: string
    started: number
  }): Promise<TerminateResult> {
    const { pids, snapshot, mode } = input
    const requested = [...new Set(pids)]
    const busy = requested.filter((pid) => this.inFlight.has(pid))
    if (busy.length > 0) {
      return this.blockedResult(
        requested[0] ?? 0,
        input.targetLabel,
        mode,
        `Encerramento ja em andamento para: ${busy.join(', ')}`,
        input.auditId,
        input.started,
        'ui',
        input.targetKind
      )
    }
    for (const pid of requested) this.inFlight.add(pid)

    const vramBefore = this.vramOf(snapshot, requested)
    const failed: TerminateResult['failed'] = []
    const killed: number[] = []
    let denied = false

    try {
      // 1) Graceful: pede para fechar, sem /F.
      for (const pid of requested) {
        // Ja morto: o laco final contabiliza uma unica vez.
        if (!isAlive(pid)) continue
        try {
          await execFileAsync('taskkill', ['/PID', String(pid)], {
            timeout: 5000,
            windowsHide: true
          })
        } catch (error) {
          const message = errorText(error)
          if (deniedMessage(message)) denied = true
          // Nao falha aqui: o graceful pode simplesmente ser ignorado.
        }
      }

      let alive = await waitForExit(requested, this.config.actions.gracefulTimeoutMs)

      // 2) Force: so quando pedido explicitamente.
      if (alive.length > 0 && mode === 'force') {
        const root = requested[0]
        if (root != null) {
          try {
            await execFileAsync('taskkill', ['/PID', String(root), '/F', '/T'], {
              timeout: 8000,
              windowsHide: true
            })
          } catch (error) {
            const message = errorText(error)
            if (deniedMessage(message)) denied = true
          }
        }
        for (const pid of alive) {
          if (!isAlive(pid)) continue
          try {
            await execFileAsync('taskkill', ['/PID', String(pid), '/F'], {
              timeout: 8000,
              windowsHide: true
            })
          } catch (error) {
            const message = errorText(error)
            if (deniedMessage(message)) denied = true
            failed.push({ pid, message: message.slice(0, 200) })
          }
        }
        alive = await waitForExit(alive, 2500)
      }

      for (const pid of requested) {
        if (!alive.includes(pid)) killed.push(pid)
      }
      for (const pid of alive) {
        if (!failed.some((entry) => entry.pid === pid)) {
          failed.push({
            pid,
            message: mode === 'force' ? 'Processo sobreviveu ao force' : 'Processo ignorou o encerramento'
          })
        }
      }

      const needsForce = alive.length > 0 && mode === 'graceful'
      const verified = alive.length === 0

      // 3) Mede VRAM depois de a amostra seguinte chegar (best effort).
      await delay(Math.min(2500, Math.max(600, this.config.sampleIntervalMs * 1.4)))
      const after = this.engine.getSnapshot()
      const vramAfter = after ? this.vramOf(after, requested) : null
      const reclaimed = vramBefore != null && vramAfter != null ? Math.max(0, vramBefore - vramAfter) : null

      const ok = verified
      const message = ok
        ? `${input.targetLabel}: ${killed.length} processo(s) encerrado(s)`
        : needsForce
          ? `${input.targetLabel}: ${alive.length} processo(s) ignoraram o pedido de fechamento; use Forcar`
          : `${input.targetLabel}: ${alive.length} processo(s) nao puderam ser encerrados${denied ? ' (requer elevacao)' : ''}`

      log.info('actions', message, { pids: requested, mode, origin: 'service' })

      return {
        ok,
        mode,
        targetKind: input.targetKind,
        targetId: input.targetId,
        targetLabel: input.targetLabel,
        requestedPids: requested,
        killedPids: killed,
        failed,
        message,
        needsForce,
        requiresElevation: denied,
        verified,
        durationMs: Date.now() - input.started,
        vramBeforeMiB: vramBefore,
        vramAfterMiB: vramAfter,
        reclaimedMiB: reclaimed,
        auditId: input.auditId,
        ts: Date.now()
      }
    } finally {
      for (const pid of requested) this.inFlight.delete(pid)
    }
  }

  private blockedResult(
    pid: number,
    label: string,
    mode: TerminateMode,
    reason: string,
    auditId: string,
    started: number,
    origin: Origin,
    targetKind: 'process' | 'workload'
  ): TerminateResult {
    const result: TerminateResult = {
      ok: false,
      mode,
      targetKind,
      targetId: targetKind === 'process' ? String(pid) : label,
      targetLabel: label,
      requestedPids: pid > 0 ? [pid] : [],
      killedPids: [],
      failed: [],
      message: reason,
      needsForce: false,
      requiresElevation: false,
      verified: false,
      durationMs: Date.now() - started,
      vramBeforeMiB: null,
      vramAfterMiB: null,
      reclaimedMiB: null,
      auditId,
      ts: Date.now()
    }
    this.audit.append({
      ...toAuditEntry(result, origin),
      allowed: false,
      reason,
      result: 'blocked'
    })
    log.warn('actions', 'bloqueado', { label, reason })
    return result
  }

  private vramOf(snapshot: Snapshot, pids: number[]): number | null {
    const set = new Set(pids)
    let total = 0
    let found = false
    for (const process of snapshot.processes) {
      if (!set.has(process.pid)) continue
      total += process.vramMiB
      found = true
    }
    return found ? Math.round(total) : null
  }
}

function errorText(error: unknown): string {
  if (typeof error === 'object' && error) {
    const candidate = error as { stderr?: string; message?: string }
    if (candidate.stderr && candidate.stderr.trim()) return candidate.stderr.trim()
    if (candidate.message) return candidate.message
  }
  return String(error)
}

function toAuditEntry(result: TerminateResult, origin: Origin): AuditEntry {
  return {
    id: result.auditId,
    ts: result.ts,
    action: result.targetKind === 'workload' ? 'terminate-workload' : 'terminate',
    targetKind: result.targetKind,
    targetId: result.targetId,
    targetLabel: result.targetLabel,
    mode: result.mode,
    origin,
    allowed: true,
    reason: null,
    result: result.ok ? 'success' : 'failed',
    message: result.message,
    pids: result.requestedPids,
    durationMs: result.durationMs,
    vramBeforeMiB: result.vramBeforeMiB,
    vramAfterMiB: result.vramAfterMiB
  }
}
