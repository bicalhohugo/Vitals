/**
 * Nomes de processos que o Vitals nunca encerra.
 *
 * A lista e conservadora de proposito: derrubar qualquer um destes pode
 * travar a sessao, derrubar a rede ou reiniciar a maquina. Nomes em
 * minusculas, sem extensao .exe.
 *
 * Para adicionar um item: abra um ADR curto em docs/adr/ explicando o risco
 * e atualize tests/protection.test.ts.
 */
export const PROTECTED_PROCESS_NAMES: readonly string[] = [
  'system',
  'system idle process',
  'registry',
  'memory compression',
  'secure system',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'svchost',
  'dwm',
  'fontdrvhost',
  'sihost',
  'ctfmon',
  'audiodg',
  'msmpeng',
  'nissrv',
  'securityhealthservice',
  'spoolsv',
  'explorer',
  'wudfhost',
  'winlogon'
]

const protectedSet = new Set(PROTECTED_PROCESS_NAMES)

/** Normaliza "chrome.exe" / "Chrome" para "chrome" antes de comparar. */
export function normalizeProcessName(name: string): string {
  return name.trim().toLowerCase().replace(/\.exe$/i, '')
}

export function isProtectedName(name: string): boolean {
  return protectedSet.has(normalizeProcessName(name))
}

/** PIDs que o Windows reserva para o kernel/idle. */
export function isKernelPid(pid: number): boolean {
  return !Number.isInteger(pid) || pid <= 4
}
