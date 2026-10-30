import { describe, expect, it } from 'vitest'
import { planProcessTermination, planWorkloadTermination } from '../src/main/actions/policy'
import { processRow, snapshot, workload } from './fixtures'

describe('planProcessTermination', () => {
  const base = snapshot({
    processes: [
      processRow({ pid: 10, name: 'chrome', startedAt: 111 }),
      processRow({ pid: 20, name: 'vitals', isSelf: true }),
      processRow({ pid: 30, name: 'lsass', isProtected: true }),
      processRow({ pid: 4, name: 'System', isProtected: true })
    ]
  })

  it('permite processo comum', () => {
    const plan = planProcessTermination(base, { pid: 10, mode: 'graceful' }, true)
    expect(plan.allowed).toBe(true)
    expect(plan.pids).toEqual([10])
    expect(plan.label).toBe('chrome')
  })

  it('bloqueia quando acoes estao desligadas', () => {
    expect(planProcessTermination(base, { pid: 10, mode: 'force' }, false).allowed).toBe(false)
  })

  it('bloqueia self, protegido e kernel', () => {
    expect(planProcessTermination(base, { pid: 20, mode: 'force' }, true).allowed).toBe(false)
    expect(planProcessTermination(base, { pid: 30, mode: 'force' }, true).allowed).toBe(false)
    expect(planProcessTermination(base, { pid: 4, mode: 'force' }, true).allowed).toBe(false)
  })

  it('bloqueia PID desconhecido', () => {
    expect(planProcessTermination(base, { pid: 999, mode: 'force' }, true).allowed).toBe(false)
  })

  it('bloqueia reuso de PID', () => {
    const plan = planProcessTermination(
      base,
      { pid: 10, mode: 'force', expectedStartedAt: 999 },
      true
    )
    expect(plan.allowed).toBe(false)
    expect(plan.reason).toMatch(/reutilizado/)
  })
})

describe('planWorkloadTermination', () => {
  const base = snapshot({
    processes: [
      processRow({ pid: 100, name: 'root' }),
      processRow({ pid: 101, name: 'worker' })
    ],
    workloads: [
      workload({ id: 'wl:100', label: 'ComfyUI', rootPid: 100, pids: [100, 101] }),
      workload({ id: 'wl:200', label: 'Servico', rootPid: 200, pids: [200, 201], isProtected: true })
    ]
  })

  it('ejeto de workload coloca a raiz primeiro', () => {
    const plan = planWorkloadTermination(base, { workloadId: 'wl:100', mode: 'graceful' }, true)
    expect(plan.allowed).toBe(true)
    expect(plan.pids).toEqual([100, 101])
    expect(plan.label).toBe('ComfyUI')
  })

  it('bloqueia workload protegido e inexistente', () => {
    expect(planWorkloadTermination(base, { workloadId: 'wl:200', mode: 'force' }, true).allowed).toBe(false)
    expect(planWorkloadTermination(base, { workloadId: 'wl:999', mode: 'force' }, true).allowed).toBe(false)
  })

  it('bloqueia workload que contenha processo protegido mesmo sem flag', () => {
    const withProtected = snapshot({
      processes: [processRow({ pid: 300, name: 'svchost', isProtected: true })],
      workloads: [workload({ id: 'wl:300', label: 'svc', rootPid: 300, pids: [300] })]
    })
    const plan = planWorkloadTermination(withProtected, { workloadId: 'wl:300', mode: 'force' }, true)
    expect(plan.allowed).toBe(false)
    expect(plan.reason).toMatch(/protegido/)
  })
})
