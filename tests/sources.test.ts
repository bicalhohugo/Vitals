import { describe, expect, it } from 'vitest'
import { parseNetstat } from '../src/main/telemetry/sources/ports'
import {
  isKernelPid,
  isProtectedName,
  normalizeProcessName
} from '../src/shared/protection'
import { formatBytes, formatMiB, formatPct, formatTemp } from '../src/shared/format'

describe('parseNetstat', () => {
  it('extrai apenas TCP em LISTENING com a porta local', () => {
    const output = [
      '',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:8188           0.0.0.0:0              LISTENING       13740',
      '  TCP    127.0.0.1:8000         0.0.0.0:0              LISTENING       9340',
      '  TCP    127.0.0.1:50000        127.0.0.1:8000         ESTABLISHED     9340',
      '  UDP    0.0.0.0:5353           *:*                                    1234'
    ].join('\r\n')

    const map = parseNetstat(output)
    expect(map.get(13740)).toEqual([8188])
    expect(map.get(9340)).toEqual([8000])
    expect(map.has(1234)).toBe(false)
  })

  it('aceita IPv6 e nao duplica portas', () => {
    const output = [
      '  TCP    [::]:8188              [::]:0                 LISTENING       13740',
      '  TCP    0.0.0.0:8188           0.0.0.0:0              LISTENING       13740'
    ].join('\n')
    expect(parseNetstat(output).get(13740)).toEqual([8188])
  })
})

describe('protection', () => {
  it('normaliza nome de processo', () => {
    expect(normalizeProcessName('  Chrome.EXE ')).toBe('chrome')
  })

  it('protege processos de sistema e nao protege apps comuns', () => {
    expect(isProtectedName('lsass.exe')).toBe(true)
    expect(isProtectedName('explorer.exe')).toBe(true)
    expect(isProtectedName('chrome.exe')).toBe(false)
    expect(isProtectedName('llama-server.exe')).toBe(false)
  })

  it('trata PIDs de kernel como reservados', () => {
    expect(isKernelPid(0)).toBe(true)
    expect(isKernelPid(4)).toBe(true)
    expect(isKernelPid(5)).toBe(false)
  })
})

describe('format', () => {
  it('formata bytes e MiB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatMiB(16311)).toBe('15.9 GB')
    expect(formatMiB(512)).toBe('512 MB')
  })

  it('formata percentual e temperatura', () => {
    expect(formatPct(42.6)).toBe('43%')
    expect(formatTemp(39.4)).toContain('39')
    expect(formatTemp(39.4)).toContain('C')
  })
})
