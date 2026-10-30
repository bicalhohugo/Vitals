# AGENTS.md — como continuar este projeto

Este repositório é compartilhado por vários agentes. **Um agente por vez.**
Antes de começar, leia este arquivo, `docs/ARCHITECTURE.md` e o topo de
`docs/WORKLOG.md`. Ao terminar, registre o que fez no WORKLOG.

## Objetivo do produto

HUD de operação para um servidor Windows que roda ComfyUI, LM Studio e o
pipeline Morpheus/TTS. O foco é **quem consome recursos** e **como ejetar com
segurança**, não gráficos bonitos. Toda decisão de produto passa por essa
pergunta: "isso ajuda o operador a achar e parar o consumidor problemático?"

## Regras invioláveis

1. **Nada encerra processo fora de `src/main/actions/terminate.ts`.**
   A UI e a API chamam `ActionService`. Não adicione `process.kill`, `taskkill`
   ou `Stop-Process` em outro lugar.
2. **Toda decisão passa por `policy.ts`.** Negar é o padrão. Se precisar liberar
   algo novo, adicione um teste em `tests/policy.test.ts`.
3. **Nunca enfraqueça `PROTECTED_PROCESS_NAMES`** (`src/shared/protection.ts`)
   sem um ADR em `docs/adr/`. Remover `lsass`, `csrss`, `winlogon`, `services`
   ou `msmpeng` da lista é regressão de segurança.
4. **Gracioso primeiro.** `taskkill /F` só com `mode: "force"` explícito. Não
   mude o fluxo para "forçar sempre" por conveniência.
5. **PID reciclado é proibido.** `expectedStartedAt` existe para isso; não
   remova a checagem.
6. **Auditoria é obrigatória**, inclusive para tentativas bloqueadas.
7. **Schema 2 é contrato público.** Mudou `src/shared/types.ts` de forma
   incompatível? Atualize `docs/CONTRACTS.md`, o probe, a UI e os testes no
   mesmo commit.
8. **O sensor `.ps1` é lido do disco em runtime** (`src/main/telemetry/sources/windows-sensor.ps1`).
   Não volte a importar com `?raw`: `scripts/probe.ts` e `tsx` não resolvem isso.
9. **Memória exibida é commit privado**, não RSS. Ver ADR-0005.

## Fluxo de trabalho

```powershell
npm install
npm run typecheck
npm test
npm run doctor
npm run probe
npm run build
```

Antes de considerar pronto:

- `npm run typecheck` limpo.
- `npm test` verde (40+ testes).
- `npm run probe` mostra 3 adaptadores quando o sensor está saudável.
- `npm run build` copia `windows-sensor.ps1` para `out/main` (log
  `[copy-assets]`).
- UI validada (quando mexer no renderer): `npm run probe:serve` e abra
  `http://127.0.0.1:4780`; confira console sem erros.

Se o browser tool não conseguir screenshot, valide por DOM:
`document.querySelectorAll('.gpu').length`, `.workload`, `tbody tr`, e o texto
do header (`8C/16T`).

## Onde mexer

| Quero… | Vá para |
| --- | --- |
| Adicionar/ajustar regra de workload | `src/shared/workloads.ts` + `tests/workloads.test.ts` |
| Mudar agrupamento por árvore | `src/main/telemetry/workloads.ts` |
| Adicionar campo no snapshot | `src/shared/types.ts` → engine → UI → docs/CONTRACTS.md |
| Coletar nova métrica no Windows | `windows-sensor.ps1` + `windows-sensor.ts` |
| Telemetria NVIDIA | `src/main/telemetry/sources/nvidia.ts` |
| Portas | `src/main/telemetry/sources/ports.ts` |
| Política de ejeção | `src/main/actions/policy.ts` |
| Execução/verificação | `src/main/actions/terminate.ts` |
| API/SSE | `src/main/http/server.ts` |
| UI | `src/renderer/src/` |
| Diagnóstico | `scripts/doctor.ts` |

## Convenções

- TypeScript estrito, sem `any` novo.
- Comentários e UI em pt-BR; identificadores em inglês.
- Aliases: `@shared/*` (renderer e main), `@renderer/*`.
- Formatação de bytes/percentual sempre por `src/shared/format.ts`.
- Prefira funções puras e testáveis para parsing/regra.
- `list`/`Map` grandes: não recalcule a cada render sem `useMemo`.

## Armadilhas já encontradas

- **`[ordered]@{ adapters = @($list) }` quebra** em PowerShell com
  "Argument types do not match". Use `$list.ToArray()`. Isso já derrubou o
  `hello` do sensor inteiro (sem adaptadores, sem cores).
- **CPU% por processo é delta.** O motor só recalcula quando o sensor publica
  um `seq` novo; caso contrário reaproveita as linhas. Não remova esse guard
  ou o CPU pisca em 0%.
- **RSS mente.** `python` do ComfyUI pode ter 14 MB de working set e 16.8 GB de
  commit privado. Use `privateBytes` para RAM.
- **`ppid = -1`** aparece para processos que o sensor não consegue abrir; eles
  viram workload próprio. Não é bug do agrupamento dos stacks de IA.
- **WARP** (`Microsoft Basic Render Driver`) é filtrado na UI quando ocioso.
- **`npm run probe -- --json`** inclui banner do npm. Use `npx tsx` direto.
- Ao editar arquivos com o tool de edição, **não escreva `\n` literal** dentro
  de string de uma linha; use quebras reais. Já comentou um `sort` inteiro por
  acidente.

## Definição de pronto

- Código + testes + typecheck + build.
- Docs afetados atualizados (`CONTRACTS.md` se o schema mudou; `WORKLOG.md`
  sempre).
- Nenhuma ação destrutiva nova sem auditoria e política.
- Commit pequeno e descritivo (ver `docs/WORKLOG.md` para o padrão).
