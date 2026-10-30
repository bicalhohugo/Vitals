import { describe, expect, it } from 'vitest'
import { evaluateHealth, averageTail } from '../src/main/telemetry/health'
import { gpuAdapter, snapshot } from './fixtures'

describe('evaluateHealth', () => {
  it('ok quando nada passa dos limites', () => {
    const result = evaluateHealth(snapshot(), 10)
    expect(result.status).toBe('ok')
    expect(result.reasons).toEqual([])
  })

  it('commit charge tem prioridade sobre RAM quando o limite aperta', () => {
    const base = snapshot()
    const result = evaluateHealth(
      snapshot({
        memory: { ...base.memory, usagePct: 70, commitPct: 95 }
      }),
      10
    )
    expect(result.status).toBe('critical')
    expect(result.reasons.join(' ')).toMatch(/Commit em 95%/)
  })

  it('VRAM critica no adaptador primario vira critical', () => {
    const gpu = gpuAdapter({ id: 'luid:x', name: 'RTX', vramTotalMiB: 1000, vramUsedMiB: 990 })
    const result = evaluateHealth(snapshot({ gpus: [gpu], primaryGpuId: gpu.id }), 10)
    expect(result.status).toBe('critical')
    expect(result.reasons.join(' ')).toMatch(/VRAM/)
  })

  it('temperatura alta vira warn', () => {
    const gpu = gpuAdapter({ id: 'luid:x', name: 'RTX', vramUsedMiB: 10, tempC: 85 })
    const result = evaluateHealth(snapshot({ gpus: [gpu], primaryGpuId: gpu.id }), 10)
    expect(result.status).toBe('warn')
    expect(result.reasons.join(' ')).toMatch(/aquecida/)
  })

  it('sensor indisponivel aparece como motivo', () => {
    const base = snapshot()
    const result = evaluateHealth(
      snapshot({
        sources: {
          ...base.sources,
          windowsSensor: { status: 'unavailable', lastUpdate: null, latencyMs: null, error: null, detail: null }
        }
      }),
      10
    )
    expect(result.status).toBe('warn')
    expect(result.reasons.join(' ')).toMatch(/Sensor/)
  })

  it('limita a cinco motivos', () => {
    const base = snapshot()
    const gpu = gpuAdapter({ id: 'luid:x', name: 'RTX', vramTotalMiB: 100, vramUsedMiB: 100, tempC: 95 })
    const result = evaluateHealth(
      snapshot({
        gpus: [gpu],
        primaryGpuId: gpu.id,
        memory: { ...base.memory, usagePct: 99, commitPct: 99 },
        cpu: { ...base.cpu, usagePct: 99 }
      }),
      99
    )
    expect(result.reasons.length).toBeLessThanOrEqual(5)
  })
})

describe('averageTail', () => {
  it('mede a cauda', () => {
    expect(averageTail([1, 2, 3, 4, 5], 2)).toBe(4.5)
    expect(averageTail([], 3)).toBe(0)
  })
})
