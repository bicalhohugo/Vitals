import type { HealthInfo, Snapshot } from '@shared/types'

export interface HealthThresholds {
  ramWarn: number
  ramCritical: number
  commitWarn: number
  commitCritical: number
  vramWarn: number
  vramCritical: number
  cpuWarn: number
  cpuCritical: number
  tempWarn: number
  tempCritical: number
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  ramWarn: 88,
  ramCritical: 95,
  commitWarn: 85,
  commitCritical: 94,
  vramWarn: 90,
  vramCritical: 97,
  cpuWarn: 85,
  cpuCritical: 95,
  tempWarn: 83,
  tempCritical: 90
}

/**
 * Saude resumida para o HUD e para agentes.
 *
 * Recebe a media de CPU dos ultimos N pontos para nao piscar em picos de 1s.
 * Commit charge entra como sinal critico: no Windows e ele que derruba as
 * coisas primeiro, antes de a RAM fisica esgotar.
 */
export function evaluateHealth(
  snapshot: Snapshot,
  cpuAverage: number,
  thresholds: HealthThresholds = DEFAULT_THRESHOLDS
): HealthInfo {
  const reasons: string[] = []
  let critical = false

  const ram = snapshot.memory.usagePct
  if (ram >= thresholds.ramCritical) {
    critical = true
    reasons.push(`RAM em ${ram.toFixed(0)}% (limite critico ${thresholds.ramCritical}%)`)
  } else if (ram >= thresholds.ramWarn) {
    reasons.push(`RAM em ${ram.toFixed(0)}%`)
  }

  const commit = snapshot.memory.commitPct
  if (commit != null) {
    if (commit >= thresholds.commitCritical) {
      critical = true
      reasons.push(`Commit em ${commit.toFixed(0)}% (limite critico ${thresholds.commitCritical}%)`)
    } else if (commit >= thresholds.commitWarn) {
      reasons.push(`Commit em ${commit.toFixed(0)}%`)
    }
  }

  const primary = snapshot.gpus.find((gpu) => gpu.id === snapshot.primaryGpuId)
  if (primary && primary.vramTotalMiB > 0) {
    const vramPct = (primary.vramUsedMiB / primary.vramTotalMiB) * 100
    if (vramPct >= thresholds.vramCritical) {
      critical = true
      reasons.push(`VRAM em ${vramPct.toFixed(0)}% (limite critico ${thresholds.vramCritical}%)`)
    } else if (vramPct >= thresholds.vramWarn) {
      reasons.push(`VRAM em ${vramPct.toFixed(0)}%`)
    }
    if (primary.tempC != null) {
      if (primary.tempC >= thresholds.tempCritical) {
        critical = true
        reasons.push(`GPU a ${primary.tempC.toFixed(0)} C`)
      } else if (primary.tempC >= thresholds.tempWarn) {
        reasons.push(`GPU aquecida: ${primary.tempC.toFixed(0)} C`)
      }
    }
  }

  if (cpuAverage >= thresholds.cpuCritical) {
    critical = true
    reasons.push(`CPU em ${cpuAverage.toFixed(0)}% (media)`)
  } else if (cpuAverage >= thresholds.cpuWarn) {
    reasons.push(`CPU em ${cpuAverage.toFixed(0)}% (media)`)
  }

  if (snapshot.sources.windowsSensor.status === 'unavailable') {
    reasons.push('Sensor de processos/GPU indisponivel')
  } else if (snapshot.sources.windowsSensor.status === 'stale') {
    reasons.push('Sensor de processos/GPU sem resposta')
  }

  if (snapshot.sources.nvidia.status === 'unavailable' && snapshot.sources.nvidia.error) {
    reasons.push('nvidia-smi indisponivel')
  }

  return {
    status: critical ? 'critical' : reasons.length > 0 ? 'warn' : 'ok',
    reasons: reasons.slice(0, 5)
  }
}

/** Media dos ultimos `window` valores de uma serie. */
export function averageTail(series: number[], window = 5): number {
  if (series.length === 0) return 0
  const slice = series.slice(-window)
  return slice.reduce((sum, value) => sum + value, 0) / slice.length
}
