# Operação

## Instalação

```powershell
cd D:\Monitor
npm install
npm run doctor
```

`doctor` verifica:

- `pwsh` (PowerShell 7) no PATH;
- categorias de contador `GPU Engine`, `GPU Process Memory`, `GPU Adapter
  Memory` e `Memory`;
- `nvidia-smi`;
- porta HTTP livre;
- versão do Node.

Se algo faltar, ele diz o que e por quê. O app ainda sobe com fontes parciais.

## Rodar

```powershell
npm run dev        # janela Electron, HMR
npm run build      # build de produção em out/
npm start          # preview do build
```

O app abre em 1480×940, tema escuro, pt-BR. A API embutida sobe junto em
`127.0.0.1:4780` quando `VITALS_HTTP=1`.

## Lançador (Vitals.bat)

Duplo clique em `Vitals.bat` na raiz do projeto. Ele:

1. confere Node.js, npm e `pwsh`;
2. roda `npm install` se `node_modules\electron` não existir;
3. roda `npm run build` se `out\main\index.js` ou `out\renderer\index.html`
   faltarem;
4. abre o Electron com o diretório do projeto como working dir (para achar o
   `.env`).

Flags:

```powershell
Vitals.bat            # abrir
Vitals.bat --rebuild  # recompilar antes (use apos git pull)
Vitals.bat --dev      # modo desenvolvimento com HMR
```

Atalho: botão direito em `Vitals.bat` → **Enviar para → Área de trabalho
(criar atalho)**. O console pisca por um instante; é normal.

> `Vitals.bat` **não** é um executável independente: ele exige Node.js e a
> pasta `node_modules`. Para distribuir sem Node, é preciso empacotar com
> `electron-builder` (ver docs/ROADMAP.md). O `.env` é lido do diretório de
> trabalho; o lançador garante que seja a raiz do projeto.

## Rodar sem Electron (agente / headless)

```powershell
npm run probe                    # resumo único e sai
npm run probe:serve              # UI + API em http://127.0.0.1:4780
npm run probe -- --watch         # resumo a cada amostra no terminal
npx tsx scripts/probe.ts --json  # Snapshot completo em JSON puro
```

- `--json` silencia o logger (`VITALS_LOG_SILENT=1`) para o stdout ser JSON
  válido. Use **`npx tsx`**, não `npm run`, porque o npm imprime banner.
- `probe:serve` exige `npm run build` para servir a UI; sem build ele sobe só
  a API.
- `probe:serve` fica em foreground. Para encerrar: `Ctrl+C` ou
  `Get-NetTCPConnection -LocalPort 4780 -State Listen | Stop-Process`.

### Consumir por script

```powershell
$s = npx tsx scripts/probe.ts --json | ConvertFrom-Json
$s.health.status
$s.workloads | Select-Object -First 5 label, vramMiB, privateBytes
$s.gpus | Select-Object name, luid, vramUsedMiB, vramTotalMiB
```

Ou via HTTP, com o servidor de pé:

```powershell
Invoke-RestMethod http://127.0.0.1:4780/api/snapshot
Invoke-RestMethod "http://127.0.0.1:4780/api/audit?limit=10"
```

## Interpretar a tela

- **Cabeçalho:** hostname, modelo de CPU, `8C/16T`, uptime, status das fontes
  (`sensor`, `nvidia`, `portas`, `discos`).
- **Saúde:** `OK` / `ATENÇÃO` / `CRÍTICO` + motivos. Em vermelho, aja.
- **GPU:** um cartão por adaptador (WARP oculto quando ocioso). VRAM, uso,
  temperatura, potência, fan, clocks, motores e os processos que mais usam
  aquela GPU — com botão **ejetar**.
- **Workloads:** a lista que importa. VRAM primeiro, depois commit privado.
  Portas aparecem como `:8188`. O botão **ejetar** derruba a árvore inteira.
- **Tabela de processos:** ordenável por CPU, commit, VRAM e GPU. `COMMIT` é o
  número honesto de RAM; o tooltip mostra o residente.
- **Rail:** histórico, memória, volumes, auditoria recente.

### O que significa cada limite

| Sinal | Atenção | Crítico |
| --- | --- | --- |
| RAM física | 88% | 95% |
| Commit charge | 85% | 94% |
| VRAM (primária) | 90% | 97% |
| GPU temp | 83 °C | 90 °C |
| CPU (média 5) | 85% | 95% |

Commit alto com RAM "ok" é o caso clássico desta máquina: o limite de commit
inclui pagefile e é ele que derruba as alocações primeiro.

## Ejetar com segurança

1. Prefira **workload** a processo solto: derruba a árvore coerente.
2. Leia o diálogo: PIDs, VRAM antes, commit.
3. **Ejetar** = gracioso. Se o processo ignorar, o diálogo oferece **forçar**.
4. Confira o resultado: `verified`, `reclaimedMiB`, `needsForce`,
   `requiresElevation`.
5. Toda tentativa está em `audit.jsonl`.

Serviços rodando como SYSTEM podem exigir elevação. O Vitals não se eleva; ele
reporta `requiresElevation: true`.

## Diagnóstico

### `npm run doctor` falha

| Mensagem | Ação |
| --- | --- |
| `pwsh nao encontrado` | instale PowerShell 7 e garanta `pwsh` no PATH |
| `categoria GPU ... indisponivel` | driver de vídeo antigo ou Windows sem WDDM 2.0; GPU fica sem uso por processo |
| `nvidia-smi nao encontrado` | instale o driver NVIDIA; a GPU funciona sem temperatura |
| `porta 4780 em uso` | mate o processo ou mude `VITALS_HTTP_PORT` |

### Header mostra `16C/16T` numa máquina 8C/16T

O `hello` do sensor não chegou. Verifique `sources.windowsSensor.detail` no
snapshot: deve dizer `3 adaptador(es)`. Se disser `0`, o `hello` falhou (ver
WORKLOG 2026-10-30 — `@($list)` em `[ordered]@{}`).

### `0 adaptador(es)` / GPU só via nvidia-smi

Sintoma: `id: nvidia:0`, sem lista de processos por GPU, `luid` ausente.
Causa: `hello` não foi emitido. Verifique o primeiro evento do sensor
manualmente:

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoProfile -File src\main\telemetry\sources\windows-sensor.ps1 -IntervalMs 2000 -ParentPid 0
```

Deve imprimir `{"type":"hello",...}` e depois `tick`.

### CPU% por processo sempre 0

- O primeiro tick é `null` por definição.
- Se persistir, o sensor não está publicando `seq` novo (veja
  `sources.windowsSensor.lastUpdate`) ou você removeu o guard de frescor no
  engine.
- Máquina ociosa: 0% é verdade. Confira o total de CPU no topo.

### Sensores `stale`

`stale` = sem tick há mais que alguns intervalos. O sensor tem watchdog; se
reiniciar, `detail` mostra `N reinicio(s)`. Se ficar stale, rode o comando
manual acima e leia o stderr.

### UI abre vazia em `probe:serve`

Faltou `npm run build` (renderer em `out/renderer`). Sem build o servidor
responde 404 na raiz, mas a API funciona.

### Porta 4780 ocupada

```powershell
Get-NetTCPConnection -LocalPort 4780 -State Listen |
  Select-Object OwningProcess
Stop-Process -Id <pid>
```

Ou use `VITALS_HTTP_PORT=4781`.

## Logs e auditoria

| Arquivo | Conteúdo |
| --- | --- |
| `%APPDATA%\Vitals\logs\vitals.log` | log do app Electron |
| `%APPDATA%\Vitals\logs\probe.log` | log do probe |
| `%APPDATA%\Vitals\logs\audit.jsonl` | toda tentativa de ejeção |

`VITALS_LOG_SILENT=1` silencia o console (arquivo continua).
`VITALS_LOG_LEVEL=debug` liga logs de debug no console.

## Limpeza

- `out/`, `node_modules/`, `logs/` e `.env` não vão para o git.
- Para parar tudo: feche a janela (o sensor morre junto via `-ParentPid`) ou
  mate o processo na porta 4780.
- Se um sensor órfão aparecer: `Get-Process pwsh | Where-Object { $_.CommandLine -like '*windows-sensor*' }`.
