import { describe, expect, it } from 'vitest'
import { buildWorkloads } from '../src/main/telemetry/workloads'
import { processRow } from './fixtures'

describe('buildWorkloads', () => {
  const rows = [
    processRow({ pid: 100, ppid: 4, name: 'explorer', isProtected: true }),
    processRow({ pid: 200, ppid: 100, name: 'Comfy Desktop', path: 'C:/Apps/Comfy Desktop.exe' }),
    processRow({ pid: 201, ppid: 200, name: 'python', path: 'C:/ComfyUI/python.exe', vramMiB: 1800 }),
    processRow({ pid: 202, ppid: 201, name: 'python', path: 'C:/ComfyUI/python.exe', vramMiB: 9000 })
  ]

  it('agrupa a arvore inteira sob a ancora, sem subir ate o explorer', () => {
    const { workloads, byPid } = buildWorkloads(rows, () => [], new Set())
    expect(workloads).toHaveLength(1)
    expect(workloads[0].rootPid).toBe(200)
    expect(workloads[0].pids.sort()).toEqual([200, 201, 202])
    expect(workloads[0].vramMiB).toBe(10800)
    expect(workloads[0].label).toBe('ComfyUI')
    expect(byPid.get(202)).toBe('wl:200')
  })

  it('nao sobe por shells/containers: pipeline iniciada no terminal vira workload proprio', () => {
    const tree = [
      processRow({ pid: 10, ppid: 4, name: 'WindowsTerminal' }),
      processRow({ pid: 11, ppid: 10, name: 'pwsh' }),
      processRow({ pid: 12, ppid: 11, name: 'uv', path: 'C:/bin/uv.exe' }),
      processRow({ pid: 13, ppid: 12, name: 'jarvis', path: 'C:/Morpheus/OpenJarvis/jarvis.exe' }),
      processRow({ pid: 14, ppid: 13, name: 'python', path: 'C:/Morpheus/python.exe' })
    ]
    const { workloads } = buildWorkloads(tree, () => [], new Set())
    const morpheus = workloads.find((entry) => entry.label === 'Morpheus / TTS')
    expect(morpheus?.rootPid).toBe(12)
    expect(morpheus?.pids.sort()).toEqual([12, 13, 14])
  })

  it('exclui processos protegidos e o proprio Vitals', () => {
    const tree = [
      processRow({ pid: 300, ppid: 4, name: 'svchost', isProtected: true }),
      processRow({ pid: 301, ppid: 300, name: 'worker' }),
      processRow({ pid: 400, ppid: 4, name: 'vitals', isSelf: true })
    ]
    const { workloads, byPid } = buildWorkloads(tree, () => [], new Set([400]))
    expect(workloads).toHaveLength(0)
    expect(byPid.size).toBe(0)
  })

  it('anexa portas e agrega CPU/RAM', () => {
    const tree = [
      processRow({ pid: 500, ppid: 4, name: 'app', cpuPct: 20, rssBytes: 100 }),
      processRow({ pid: 501, ppid: 500, name: 'worker', cpuPct: 30, rssBytes: 200 })
    ]
    const { workloads } = buildWorkloads(tree, (pid) => (pid === 501 ? [8188] : []), new Set())
    expect(workloads[0].ports).toEqual([8188])
    expect(workloads[0].cpuPct).toBe(50)
    expect(workloads[0].rssBytes).toBe(300)
  })

  it('desambigua rotulos repetidos', () => {
    const tree = [
      processRow({ pid: 600, ppid: 4, name: 'chrome' }),
      processRow({ pid: 700, ppid: 4, name: 'chrome' })
    ]
    const { workloads } = buildWorkloads(tree, () => [], new Set())
    expect(workloads.map((entry) => entry.label).sort()).toEqual(['Navegador (600)', 'Navegador (700)'])
  })

  it('nao trava com ciclo de ppid', () => {
    const tree = [
      processRow({ pid: 1, ppid: 2, name: 'a' }),
      processRow({ pid: 2, ppid: 1, name: 'b' })
    ]
    const { workloads } = buildWorkloads(tree, () => [], new Set())
    expect(workloads.length).toBeGreaterThan(0)
  })
})
