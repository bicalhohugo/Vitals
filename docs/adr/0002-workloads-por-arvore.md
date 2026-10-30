# ADR-0002 — Workloads como árvore de processos + regras

**Data:** 2026-10-30
**Status:** aceito

## Contexto

Listar 250 processos não responde "quem está consumindo". O ComfyUI é um
`Comfy Desktop → python → python`; o LM Studio é `Bionic → llama-server +
lmlink-connector`; o Morpheus é `uv → jarvis → python → python`. Agrupar só
por nome de processo separa o que deveria ser uma unidade operacional.

## Decisão

Para cada processo, subir a cadeia de `ppid` até o primeiro ancestral que seja
**container** (explorer, svchost, shells, dwm, code…). Esse nó é a âncora do
workload. Filhos de *service hosts* do sistema não viram workloads.

A âncora é enriquecida por regras em `src/shared/workloads.ts` (nome/caminho →
label e tipo). A unidade de ejeção é o workload inteiro.

## Consequências

- "Ejetar ComfyUI" derruba a árvore coerente, não só um `python`.
- Regras são declarativas e testáveis; adicionar um stack é uma entrada.
- `ppid` ausente (`-1`) cria workloads degenerados; aceitável e visível.
- Containers novos precisam ser adicionados conscientemente: um shell não
  deve virar âncora, senão todo comando vira workload.

## Alternativas descartadas

- Agrupar por nome de imagem: funde instâncias distintas.
- Agrupar por linha de comando: frágil e caro.
- Só lista de processos: não é o produto.
