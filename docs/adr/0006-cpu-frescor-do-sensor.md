# ADR-0006 — Só recalcular CPU quando o sensor publica seq novo

**Data:** 2026-10-30
**Status:** aceito

## Contexto

O motor roda a cada 1,5 s e o sensor também, mas os dois relógios derivam. Em
um tick do motor em que o sensor ainda não publicou amostra nova, o delta de
`TotalProcessorTime` é zero (mesmos valores), e o CPU% de todos os processos
vira 0. Na UI isso pisca; no probe, o resumo saía todo em 0%.

## Decisão

O engine guarda `lastSensorSeq`. Quando o `seq` do tick do sensor não mudou:

- não recalcula linhas nem workloads;
- reaproveita `processes`/`workloads` do snapshot anterior;
- não atualiza `previousProcesses`/`previousProcessAt`.

Quando muda, calcula o delta normalmente.

O `probe` espera até ~6 s pela primeira amostra com `cpuPct != null`, em vez de
dormir um valor fixo.

## Consequências

- CPU% estável e honesto; sem piscadas.
- Um tick "sem novidade" ainda atualiza GPU/memória/histórico (vindos do mesmo
  tick, portanto idênticos).
- Quem mexer no loop precisa manter o guard; há comentário no código e
  armadilha registrada no AGENTS.md.

## Alternativas descartadas

- Calcular sempre: zera CPU.
- Interpolar: inventa número.
- Aumentar o intervalo do motor: não resolve a fase.
