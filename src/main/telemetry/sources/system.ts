import os from 'node:os'
import type { CpuSample, MemorySample } from '@shared/types'

interface CpuSnapshot {
  perCore: { idle: number; total: number }[]
  at: number
}

function readCpu(): CpuSnapshot {
  const perCore = os.cpus().map((cpu) => {
    const times = cpu.times
    const total = times.user + times.nice + times.sys + times.idle + times.irq
    return { idle: times.idle, total }
  })
  return { perCore, at: Date.now() }
}

function emptyCpu(): CpuSample {
  return { usagePct: 0, perCorePct: [], loadAvg: null, speedMhz: null }
}

/**
 * CPU e memoria via APIs nativas do Node.
 *
 * Percentual por nucleo e calculado por delta das times do os.cpus().
 * O uso total e a media dos nucleos, equivalente ao Gerenciador de Tarefas.
 */
export class SystemSampler {
  private previous = readCpu()
  private lastCpu: CpuSample = emptyCpu()
  private lastMemory: MemorySample = {
    totalBytes: os.totalmem(),
    usedBytes: 0,
    availableBytes: os.freemem(),
    usagePct: 0,
    committedBytes: null,
    commitLimitBytes: null,
    commitPct: null,
    cacheBytes: null
  }

  sample(): { cpu: CpuSample; memory: MemorySample } {
    const current = readCpu()
    const elapsed = current.at - this.previous.at

    if (elapsed >= 200 && current.perCore.length === this.previous.perCore.length) {
      const perCorePct = current.perCore.map((core, index) => {
        const before = this.previous.perCore[index]
        const totalDelta = core.total - before.total
        const idleDelta = core.idle - before.idle
        if (totalDelta <= 0) return 0
        return Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100))
      })
      const usagePct = perCorePct.reduce((sum, value) => sum + value, 0) / perCorePct.length
      const loadAvg = os.loadavg()
      const hasLoad = loadAvg.some((value) => value > 0)
      const speeds = os.cpus().map((cpu) => cpu.speed).filter((speed) => speed > 0)
      this.lastCpu = {
        usagePct,
        perCorePct,
        loadAvg: hasLoad ? [loadAvg[0], loadAvg[1], loadAvg[2]] : null,
        speedMhz: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null
      }
      this.previous = current
    }

    const totalBytes = os.totalmem()
    const availableBytes = os.freemem()
    const usedBytes = Math.max(0, totalBytes - availableBytes)
    this.lastMemory = {
      ...this.lastMemory,
      totalBytes,
      availableBytes,
      usedBytes,
      usagePct: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
    }

    return { cpu: this.lastCpu, memory: this.lastMemory }
  }
}
