import { describe, expect, it } from 'vitest'
import { buildProcessRows, buildGpuProcesses } from '../src/main/telemetry/processes'
import type { SensorProcess } from '../src/main/telemetry/sources/windows-sensor'

function sensorProcess(partial: Partial<SensorProcess> & { id: number; name: string }): SensorProcess {
  return { ppid: -1, ws: 0, priv: 0, cpu: 0, threads: 1, path: null, start: 1, ...partial }
}

describe('buildProcessRows', () => {
  it('calcula CPU% por delta, na convencao do Gerenciador de Tarefas', () => {
    const previous = new Map([[10, { cpu: 10, start: 1 }]])
    const { rows } = buildProcessRows({
      procs: [sensorProcess({ id: 10, name: 'python', cpu: 12.4 })],
      gpu: [],
      vram: [],
      previous,
      elapsedMs: 2000,
      logicalCpus: 8,
      selfPids: new Set(),
      now: Date.now()
    })
    // 2.4s de CPU em 2s de parede = 1.2 nucleos => 15% de 8 nucleos
    expect(rows[0].cpuPct).toBeCloseTo(15, 5)
  })

  it('ignora delta quando o PID foi reutilizado (start diferente)', () => {
    const previous = new Map([[10, { cpu: 10, start: 111 }]])
    const { rows } = buildProcessRows({
      procs: [sensorProcess({ id: 10, name: 'python', cpu: 20, start: 222 })],
      gpu: [],
      vram: [],
      previous,
      elapsedMs: 2000,
      logicalCpus: 8,
      selfPids: new Set(),
      now: Date.now()
    })
    expect(rows[0].cpuPct).toBeNull()
  })

  it('soma VRAM de todos os adaptadores e marca o processo como auto-protegido', () => {
    const { rows } = buildProcessRows({
      procs: [sensorProcess({ id: 42, name: 'llama-server', ws: 1024, priv: 2048 })],
      gpu: [{ pid: 42, luid: '0x0:0x1', util: 30, engines: { Compute: 30 } }],
      vram: [
        { pid: 42, luid: '0x0:0x1', dedicated: 1024 ** 3, shared: 0 },
        { pid: 42, luid: '0x0:0x2', dedicated: 1024 ** 3, shared: 512 * 1024 ** 2 }
      ],
      previous: new Map(),
      elapsedMs: 0,
      logicalCpus: 16,
      selfPids: new Set([42]),
      now: Date.now()
    })
    expect(rows[0].vramMiB).toBe(2048)
    expect(rows[0].sharedVramMiB).toBe(512)
    expect(rows[0].gpuAdapters).toEqual(['luid:0x0:0x1', 'luid:0x0:0x2'])
    expect(rows[0].isSelf).toBe(true)
    expect(rows[0].isProtected).toBe(true)
  })

  it('marca kernel/PIDs baixos como protegidos', () => {
    const { rows } = buildProcessRows({
      procs: [sensorProcess({ id: 4, name: 'System' })],
      gpu: [],
      vram: [],
      previous: new Map(),
      elapsedMs: 0,
      logicalCpus: 16,
      selfPids: new Set(),
      now: Date.now()
    })
    expect(rows[0].isProtected).toBe(true)
  })
})

describe('buildGpuProcesses', () => {
  it('junta uso e VRAM por pid e ordena por VRAM', () => {
    const result = buildGpuProcesses(
      [
        { pid: 1, luid: 'l', util: 5, engines: { '3D': 5 } },
        { pid: 2, luid: 'l', util: 90, engines: { Compute: 90 } }
      ],
      [
        { pid: 1, luid: 'l', dedicated: 0, shared: 0 },
        { pid: 2, luid: 'l', dedicated: 2 * 1024 * 1024, shared: 0 }
      ],
      'luid:l'
    )
    expect(result.map((entry) => entry.pid)).toEqual([2, 1])
    expect(result[0].vramMiB).toBe(2)
    expect(result[0].engines.Compute).toBe(90)
  })
})
