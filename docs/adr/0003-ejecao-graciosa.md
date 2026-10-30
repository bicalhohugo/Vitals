# ADR-0003 — Ejeção graciosa primeiro, força explícita

**Data:** 2026-10-30
**Status:** aceito

## Contexto

O HUD existe para parar workloads que apertam a máquina. Matar com `/F` por
padrão perde estado (checkpoints do ComfyUI, cache do LM Studio) e pode corromper
arquivos. Mas um processo travado precisa de saída.

## Decisão

1. Toda ejeção passa por `ActionService` e por `policy.ts`.
2. Sempre começa com `taskkill /PID` (sem `/F`).
3. Espera `VITALS_GRACEFUL_TIMEOUT_MS`.
4. Só usa `/F` quando `mode: "force"` foi explicitamente pedido (UI mostra
   segunda confirmação; API aceita `mode: "force"`).
5. Verifica se os PIDs morreram e reporta `verified`, `needsForce`,
   `requiresElevation`, VRAM antes/depois.
6. Audita toda tentativa, inclusive bloqueios.

## Consequências

- Operação segura por padrão; o custo é um clique extra quando trava.
- `needsForce` é o sinal para a UI oferecer escalonamento — não é falha
  silenciosa.
- Sem elevação, serviços do SYSTEM falham com `requiresElevation`; o app não
  tenta UAC sozinho.

## Alternativas descartadas

- `/F` sempre: rápido, destrutivo.
- `Stop-Process` do PowerShell: menos controle de árvore e de saída.
- Matar só o root: deixa filhos órfãos segurando VRAM.
