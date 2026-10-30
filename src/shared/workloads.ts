/**
 * Regras para transformar PIDs em workloads legiveis.
 *
 * Nao ha nada especifico desta maquina aqui por acidente: as regras cobrem os
 * stacks que rodam no servidor (ComfyUI, LM Studio, Morpheus/TTS, navegadores,
 * terminais) e sao faceis de estender. Para adicionar uma regra, siga
 * docs/CONTRACTS.md#workloads e registre o caso em tests/workloads.test.ts.
 */

export interface WorkloadRule {
  id: string
  label: string
  kind: string
  /** Casa com o nome do processo (sem .exe), case-insensitive. */
  names?: string[]
  /** Casa com trecho do caminho completo, case-insensitive. */
  pathIncludes?: string[]
  /** Menor prioridade vence? Nao: a primeira regra que casar vence. */
}

export const WORKLOAD_RULES: readonly WorkloadRule[] = [
  {
    id: 'comfyui',
    label: 'ComfyUI',
    kind: 'ai',
    names: ['comfy desktop', 'comfyui'],
    pathIncludes: ['comfyui', 'comfy-desktop', 'comfy desktop']
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'ai',
    names: ['bionic', 'llama-server', 'lmlink-connector', 'lm studio'],
    pathIncludes: ['.lmstudio', 'lm-studio', 'lmstudio']
  },
  {
    id: 'morpheus',
    label: 'Morpheus / TTS',
    kind: 'ai',
    names: ['jarvis'],
    pathIncludes: ['morpheus-backstage', 'openjarvis', 'kokoro', 'chatterbox']
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    kind: 'dev',
    names: ['opencode', 'opencode-cli'],
    pathIncludes: ['@opencodedesktop', 'opencode']
  },
  {
    id: 'browser',
    label: 'Navegador',
    kind: 'desktop',
    names: ['chrome', 'msedge', 'firefox', 'brave', 'opera']
  },
  {
    id: 'terminal',
    label: 'Terminal',
    kind: 'desktop',
    names: ['windowsterminal', 'openconsole', 'conhost']
  }
]

/**
 * Processos que nunca sao ancora de workload: sao containers do sistema ou
 * shells interativos. A busca sobe a arvore ate o primeiro filho deles.
 */
export const CONTAINER_PROCESS_NAMES: readonly string[] = [
  'explorer',
  'services',
  'svchost',
  'wininit',
  'winlogon',
  'csrss',
  'smss',
  'dwm',
  'cmd',
  'powershell',
  'pwsh',
  'conhost',
  'windowsterminal',
  'openconsole',
  'bash',
  'wsl',
  'code'
]

const containerSet = new Set(CONTAINER_PROCESS_NAMES)

/**
 * Containers que hospedam servicos do sistema. Processos cujo ancestral mais
 * alto e um destes NAO viram workload: sao servicos, nao apps ejetaveis.
 * (explorer e um container, mas nao um service host: apps abertos por ele sao
 * ejetaveis.)
 */
export const SYSTEM_HOST_NAMES: readonly string[] = [
  'system',
  'registry',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'svchost',
  'memory compression',
  'secure system'
]

const systemHostSet = new Set(SYSTEM_HOST_NAMES)

export function isSystemHostName(name: string): boolean {
  return systemHostSet.has(name.trim().toLowerCase().replace(/\.exe$/i, ''))
}

export function isContainerName(name: string): boolean {
  return containerSet.has(name.trim().toLowerCase().replace(/\.exe$/i, ''))
}

export function matchWorkloadRule(input: {
  name: string
  path: string | null
}): WorkloadRule | null {
  const name = input.name.trim().toLowerCase().replace(/\.exe$/i, '')
  const path = (input.path ?? '').toLowerCase()
  for (const rule of WORKLOAD_RULES) {
    if (rule.names?.some((candidate) => candidate === name)) return rule
    if (path && rule.pathIncludes?.some((fragment) => path.includes(fragment))) {
      return rule
    }
  }
  return null
}
