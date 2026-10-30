import { describe, expect, it } from 'vitest'
import { RingBuffer } from '../src/main/telemetry/ring-buffer'

describe('RingBuffer', () => {
  it('guarda no maximo a capacidade', () => {
    const buffer = new RingBuffer(3)
    for (const value of [1, 2, 3, 4, 5]) buffer.push(value)
    expect(buffer.toArray()).toEqual([3, 4, 5])
    expect(buffer.length).toBe(3)
    expect(buffer.max).toBe(3)
  })

  it('rejeita capacidade invalida', () => {
    expect(() => new RingBuffer(1)).toThrow()
    expect(() => new RingBuffer(2.5)).toThrow()
  })

  it('toArray devolve copia', () => {
    const buffer = new RingBuffer(2)
    buffer.push(7)
    const copy = buffer.toArray()
    copy.push(99)
    expect(buffer.toArray()).toEqual([7])
  })
})
