/** Buffer circular simples para as series do HUD. */
export class RingBuffer {
  private items: number[] = []

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new Error(`capacidade invalida: ${capacity}`)
    }
  }

  push(value: number): void {
    this.items.push(value)
    if (this.items.length > this.capacity) this.items.shift()
  }

  toArray(): number[] {
    return [...this.items]
  }

  get length(): number {
    return this.items.length
  }

  get max(): number {
    return this.capacity
  }

  clear(): void {
    this.items = []
  }
}
