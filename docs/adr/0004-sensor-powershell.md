# ADR-0004 — Sensor em PowerShell 7, não módulo nativo

**Data:** 2026-10-30
**Status:** aceito

## Contexto

Precisamos de: processos com `ppid`, contadores de GPU por processo/LUID,
VRAM, commit charge e nomes de adaptador. As opções eram:

- módulo nativo Node (N-API) lendo PDH/DXGI;
- processo auxiliar em C#/PowerShell;
- só `nvidia-smi` + WMI.

## Decisão

Um script PowerShell 7 (`windows-sensor.ps1`) compila um bloco C# com
`Add-Type` para DXGI e `NtQueryInformationProcess`, lê os contadores via
`System.Diagnostics.PerformanceCounter`, e conversa com o Node por **JSON
lines** no stdout. O TS spawna `pwsh -File` e faz o parse.

O `.ps1` é lido do disco em runtime (não `?raw`), e o build copia para
`out/main`.

## Consequências

- Zero dependência nativa para compilar/instalar; itera-se no `.ps1` sem
  rebuild.
- `Add-Type` custa ~4 s no start; o app mostra `starting` e a UI espera.
- Precisa de `pwsh` instalado (pré-requisito documentado).
- Debug é fácil: rodar o `.ps1` e ler o JSON.
- Custo de serialização: ~250 processos + contadores a cada 1,5 s é ok
  (amostra ~400 ms).
- Watchdog e `-ParentPid` compensam a fragilidade de um processo externo.

## Alternativas descartadas

- N-API: melhor performance, muito mais código e build por versão de Node.
- Só WMI: sem GPU por processo, sem `ppid` confiável, lento.
- `nvidia-smi` só: não vê AMD/WARP nem VRAM por processo.
