# ADR-0005 — Memória exibida é commit privado, não RSS

**Data:** 2026-10-30
**Status:** aceito

## Contexto

No Windows, `WorkingSet64` (RSS) pode ser trimado pelo gerenciador de memória.
Medimos o `python` do ComfyUI (pid 13740): **working set ~14 MB**, mas
**16,4 GB de commit privado**. Mostrar RSS faria o HUD dizer que o maior
consumidor da máquina usa 14 MB — inútil e perigoso para decidir ejeção.

## Decisão

- `ProcessRow.privateBytes` e `Workload.privateBytes` são o número de "RAM".
- A UI rotula a coluna como `COMMIT`; o tooltip mostra o residente.
- Filtro de workloads relevantes usa commit > 300 MB.
- A barra de workload usa `commitLimitBytes` como denominador.
- Ordenação: VRAM desc, depois commit privado desc.
- `rssBytes` continua no contrato para diagnóstico, mas não é o número
  principal.

## Consequências

- Números batem com o Gerenciador de Tarefas (coluna "Memória (conjunto de
  trabalho privado)" / commit) e com a realidade de pressão.
- Commit pode incluir memória compartilhada/paginada; é o que o Windows
  contabiliza para o limite.
- O probe e os agentes passam a reportar commit; documentado no CONTRACTS.

## Alternativas descartadas

- RSS: subestima páginas paginadas/trimmed.
- Soma de RSS + commit: confuso e sem significado único.
- Memória "ativa" do Task Manager: API não documentada/estável.
