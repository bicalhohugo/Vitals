import type { GpuProcessInfo, ProcessRow } from '@shared/types'
import { isKernelPid, isProtectedName } from '@shared/protection'
import type { SensorGpuProcess, SensorProcess, SensorVramProcess } from './sources/windows-sensor'

export interface PreviousProcessSample {
  cpu: number | null
  start: number | null
}

export interface BuildProcessRowsInput {
  procs: SensorProcess[]
  gpu: SensorGpuProcess[]
  vram: SensorVramProcess[]
  previous: Map<number, PreviousProcessSample>
  elapsedMs: number
  logicalCpus: number
  selfPids: Set<number>
  now: number
}

export interface BuildProcessRowsResult {
  rows: ProcessRow[]
  nextPrevious: Map<number, PreviousProcessSample>
}

const MIB = 1024 * 1024

/**
 * Junta processos do sensor com VRAM/utilizacao de GPU e calcula CPU% por delta.
 *
 * CPU% segue a convencao do Gerenciador de Tarefas: 100% = todos os nucleos
 * logicos ocupados. Para "nucleos equivalentes", divida por 100/threads.
 */
export function buildProcessRows(input: BuildProcessRowsInput): BuildProcessRowsResult {
  const vramByPid = new Map<number, { dedicated: number; shared: number }>()
  for (const entry of input.vram) {
    const current = vramByPid.get(entry.pid) ?? { dedicated: 0, shared: 0 }
    current.dedicated += entry.dedicated
    current.shared += entry.shared
    vramByPid.set(entry.pid, current)
  }

  const utilByPid = new Map<number, number>()
  const adaptersByPid = new Map<number, Set<string>>()
  const trackAdapter = (pid: number, luid: string): void => {
    const set = adaptersByPid.get(pid) ?? new Set<string>()
    set.add(`luid:${luid}`)
    adaptersByPid.set(pid, set)
  }

  for (const entry of input.gpu) {
    utilByPid.set(entry.pid, Math.max(utilByPid.get(entry.pid) ?? 0, entry.util))
    trackAdapter(entry.pid, entry.luid)
  }
  for (const entry of input.vram) {
    // VRAM alocada tambem revela o adaptador, mesmo sem utilizacao no instante.
    trackAdapter(entry.pid, entry.luid)
  }

  const nextPrevious = new Map<number, PreviousProcessSample>()
  const rows: ProcessRow[] = []
  const elapsedSeconds = input.elapsedMs / 1000

  for (const process of input.procs) {
    if (!Number.isFinite(process.id) || process.id <= 0) continue

    const previous = input.previous.get(process.id)
    const sameProcess =
      !previous || previous.start == null || process.start == null || previous.start === process.start

    let cpuPct: number | null = null
    if (
      previous &&
      sameProcess &&
      previous.cpu != null &&
      process.cpu != null &&
      elapsedSeconds > 0
    ) {
      const deltaCpu = process.cpu - previous.cpu
      if (deltaCpu >= 0) {
        const coresUsed = deltaCpu / elapsedSeconds
        cpuPct = Math.min(100, Math.max(0, (coresUsed / input.logicalCpus) * 100))
      }
    }

    const vram = vramByPid.get(process.id)
    const self = input.selfPids.has(process.id)

    rows.push({
      pid: process.id,
      ppid: process.ppid > 0 ? process.ppid : null,
      name: process.name,
      path: process.path,
      cpuPct,
      cpuTimeSec: process.cpu,
      rssBytes: process.ws,
      privateBytes: process.priv,
      vramMiB: vram ? vram.dedicated / MIB : 0,
      sharedVramMiB: vram ? vram.shared / MIB : 0,
      gpuUtilPct: utilByPid.get(process.id) ?? null,
      gpuAdapters: [...(adaptersByPid.get(process.id) ?? [])],
      threads: process.threads,
      startedAt: process.start,
      isProtected: self || isKernelPid(process.id) || isProtectedName(process.name),
      isSelf: self,
      workloadId: null
    })

    nextPrevious.set(process.id, { cpu: process.cpu, start: process.start })
  }

  return { rows, nextPrevious }
}

/** Converte o payload do sensor (ja filtrado por adaptador) em GpuProcessInfo[]. */
export function buildGpuProcesses(
  gpu: SensorGpuProcess[],
  vram: SensorVramProcess[],
  adapterId: string
): GpuProcessInfo[] {
  const vramByPid = new Map(vram.map((entry) => [entry.pid, entry]))
  const pids = new Set<number>([...gpu.map((entry) => entry.pid), ...vram.map((entry) => entry.pid)])
  const result: GpuProcessInfo[] = []
  for (const pid of pids) {
    const gpuEntry = gpu.find((entry) => entry.pid === pid)
    const vramEntry = vramByPid.get(pid)
    result.push({
      pid,
      adapterId,
      vramMiB: vramEntry ? vramEntry.dedicated / MIB : 0,
      sharedMiB: vramEntry ? vramEntry.shared / MIB : 0,
      utilPct: gpuEntry ? gpuEntry.util : 0,
      engines: gpuEntry ? { ...gpuEntry.engines } : {}
    })
  }
  return result.sort((a, b) => b.vramMiB - a.vramMiB)
}
