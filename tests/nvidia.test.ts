import { describe, expect, it } from 'vitest'
import { parseNvidiaCsvLine, normalizeGpuName } from '../src/main/telemetry/sources/nvidia'

const LINE =
  'NVIDIA GeForce RTX 5060 Ti, 617.42, 16311, 12361, 3950, 1, 4, 39, 10.66, 180.00, 300, 7001, 0'

describe('parseNvidiaCsvLine', () => {
  it('converte a linha completa', () => {
    const sample = parseNvidiaCsvLine(LINE)
    expect(sample).not.toBeNull()
    expect(sample?.name).toBe('NVIDIA GeForce RTX 5060 Ti')
    expect(sample?.vramTotalMiB).toBe(16311)
    expect(sample?.vramUsedMiB).toBe(12361)
    expect(sample?.tempC).toBe(39)
    expect(sample?.powerW).toBe(10.66)
    expect(sample?.fanPct).toBe(0)
  })

  it('trata N/A como null', () => {
    const sample = parseNvidiaCsvLine(
      'GPU, 1, 100, 10, 90, N/A, N/A, N/A, N/A, N/A, N/A, N/A, N/A'
    )
    expect(sample).not.toBeNull()
    expect(sample?.tempC).toBeNull()
    expect(sample?.utilPct).toBe(0)
  })

  it('rejeita linha curta', () => {
    expect(parseNvidiaCsvLine('GPU, 1, 2')).toBeNull()
  })
})

describe('normalizeGpuName', () => {
  it('normaliza espacos e caixa para o pareamento com DXGI', () => {
    expect(normalizeGpuName('  NVIDIA   GeForce RTX 5060 Ti ')).toBe('nvidia geforce rtx 5060 ti')
  })
})
