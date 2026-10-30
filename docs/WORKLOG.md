# Worklog

Registro cronológico do que foi feito e do que foi aprendido. **Toda sessão de
agente termina com uma entrada aqui.** Mais recente no topo.

Formato: data, objetivo, mudanças, descobertas, validação, pendências.

---

## 2026-10-30 (4) — Bandeja, instalador NSIS e assinatura (preparada)

**Objetivo:** fechar a distribuição: bandeja para manter o HUD vivo, instalador
com atalhos e caminho documentado para assinatura.

### Mudanças

- `src/main/index.ts`: `Tray` com menu (abrir, saúde, RAM/commit, GPU, logs,
  sair), tooltip atualizado por snapshot (throttle de 15 s) e clique alternando
  a janela. Fechar esconde **só se** a bandeja existir; `before-quit` marca
  `isQuitting` e destrói a bandeja.
- `VITALS_TRAY` (padrão `1`) em `config.ts` e `.env.example`.
- `build/tray.png` (64×64, ECG transparente) copiado para `out/main` pelo
  `copy-assets`; fallback para `build/tray.png` em desenvolvimento.
- `electron-builder.yml`: alvo `nsis` (por usuário, assistido, atalhos no
  Desktop e Menu Iniciar, `deleteAppDataOnUninstall: false`) e
  `artifactName` por alvo.
- Scripts `dist:setup` e `dist:all`.
- Docs: README, OPERATIONS (bandeja, instalador, assinatura), ROADMAP, AGENTS.

### Validação

- `npm run typecheck` limpo; 40 testes passando.
- `dist\Vitals-0.1.0-portatil.exe` = 105,6 MB;
  `dist\Vitals-0.1.0-setup.exe` = 116,4 MB.
- Instalação silenciosa `/S /D=D:\Monitor\dist\install-test`: exit 0, atalhos no
  Desktop e Menu Iniciar, `Uninstall Vitals.exe`, registro `Vitals 0.1.0`.
- App instalado: `/api/health` OK, sensor `live`, 3 GPUs, `8C/16T`, log
  `tray: icone criado`.
- `taskkill /PID <main>` sem `/F`: processo sobreviveu e log registrou
  `minimizada para a bandeja`; depois `Stop-Process -Force`.
- Desinstalação `/S`: exit 0; pasta, atalhos e registro removidos; logs
  preservados.
- Portátil re-testado após a bandeja: health OK e tray criada.

### Descobertas / armadilhas

- `taskkill` sem `/F` em app com bandeja **não encerra** — é o teste correto do
  WM_CLOSE, mas confunde se o objetivo era matar.
- Instalador NSIS: `/D=` precisa ser o **último** argumento.
- Se `tray.png` faltar/for inválido, não esconder a janela (evita app preso).
- Ícone de 512 px na bandeja fica ruim; usar 64 px e `resize({16, 16})`.

### Pendências

- Assinatura real: só falta certificado (`CSC_LINK`/`CSC_KEY_PASSWORD`).
- Testar em máquina limpa (sem Node/pwsh) e auto-update.

---

## 2026-10-30 (3) — Executável portátil

**Objetivo:** gerar um `.exe` de arquivo único, sem exigir Node no destino.

### Mudanças

- `electron-builder` 26.18 como devDependency; scripts `npm run dist` e
  `npm run dist:dir`.
- `electron-builder.yml`: alvo `portable` x64, `files` com whitelist
  (`out/**`, `package.json`), `asar: true`, ícone `build/icon.png`.
- Ícone 512×512 gerado com `System.Drawing` (fundo escuro, grade e ECG verde).
- `loadDotEnv` passou a procurar `.env` em: cwd,
  `PORTABLE_EXECUTABLE_DIR` (portable) e `dirname(process.execPath)`
  (instalado). Antes só cwd.
- `package.json` ganhou `author`.

### Por que não precisou de `asarUnpack`

O sensor TS lê o `.ps1` via `fs` (o Electron redireciona leitura dentro do
`asar`) e grava uma cópia em `%TEMP%\vitals\windows-sensor.ps1` antes de
chamar o `pwsh`. O filho nunca abre o caminho dentro do `asar`.

### Validação

- `dist\Vitals-0.1.0-portatil.exe` = **105,6 MB**.
- Executado com um `.env` ao lado (`VITALS_HTTP_PORT=4798`):
  - `/api/snapshot` respondeu na 4798 (confirma `PORTABLE_EXECUTABLE_DIR`);
  - `cores=8`, `threads=16`; 3 GPUs (NVIDIA, AMD, WARP);
  - sensor `live`, `3 adaptador(es)`, 0 reinícios;
  - workloads reais (ComfyUI 4,0 GB VRAM / 19 GB commit).
- Processos encerrados após o teste; `.env` removido; `dist/` fora do git.

### Pendências

- Assinatura de código (SmartScreen) e instalador NSIS com atalho.
- Testar o portable em uma máquina limpa (sem Node) — o teste foi na mesma
  máquina, mas o pacote não referencia `node_modules`.

---

## 2026-10-30 (2) — Lançador Windows

**Objetivo:** abrir o app com duplo clique, sem decorar comandos npm.

### Mudanças

- `Vitals.bat` na raiz: confere Node/npm/pwsh, instala dependências e compila
  sob demanda, abre o Electron com o projeto como working dir.
  Flags `--rebuild` e `--dev`.
- `src/main/index.ts` passou a chamar `loadDotEnv()` antes de `loadConfig()`.
  Antes só o probe lia `.env`; na janela Electron a configuração era ignorada.

### Descobertas

- `start "" "electron.exe" "%~dp0"` **falha silenciosamente**: o argumento
  citado termina em `\`, que escapa a aspa na linha de comando. Solução:
  `start "" /d "%~dp0" "electron.exe" .`.
- Capturar a saída de `cmd /c Vitals.bat` no PowerShell **trava**: o Electron
  herda o stdout e o pipe só fecha quando o app fecha. Em teste, use
  `Start-Process` sem redirecionar.
- `npm start` (electron-vite preview) não é necessário: `electron.exe .` usa
  `package.json main` e carrega `out/renderer` direto.

### Validação

- `Vitals.bat` abriu o app; `/api/health` respondeu em `4799` (porta vinda de
  um `.env` temporário), sensor publicou a primeira amostra em ~4 s.
- `.env` removido depois do teste; config padrão intacta.

---

## 2026-10-30 — Sensor saudável, memória honesta, docs

**Objetivo:** fechar o schema 2 com dados reais (3 adaptadores, CPU% por
processo), corrigir a representação de memória e documentar o projeto para
outros agentes.

### Correções

1. **`hello` do sensor quebrava** com `Argument types do not match` ao montar
   `[ordered]@{ ... adapters = @($adapters) }` (`adapters` é
   `List[object]`). Consequência: nenhum `hello` era emitido, o TS via
   `0 adaptador(es)` e `cores=0`, caía no fallback `nvidia-smi` (`nvidia:0`,
   sem processos por GPU) e mostrava `16C/16T`.
   - Fix: `$adapters.ToArray()` e `$script:errors.ToArray()`.
   - Diagnóstico: isolar `[ordered]@{ adapters=@($list) }` em PowerShell puro
     reproduz o erro; `.ToArray()` resolve.
   - Validado: hello com 3 adaptadores (`CE41` RTX 5060 Ti, `1181E` AMD iGPU,
     `1178E` WARP), `cores=8`, `threads=16`, `native=true`.

2. **CPU% por processo piscava em 0.** O motor recalcula a cada 1,5 s, mas o
   sensor pode não ter publicado tick novo; o delta virava 0.
   - Fix: `lastSensorSeq` no engine; só recalcula linhas/workloads quando o
     `seq` muda, senão reaproveita o snapshot anterior.
   - `probe` agora espera a primeira amostra com `cpuPct != null` (até ~6 s) em
     vez de dormir um valor fixo.
   - Validado: `pwsh` do sensor 3,89%, `node` 0,10%, `opencode-cli` 0,06%.

3. **RAM exibida era RSS.** `python` 13740: WS ~14 MB, commit privado 16,4 GB.
   - UI, probe e ordenação passaram a usar `privateBytes` (commit), com RSS no
     tooltip. Workloads filtram por commit > 300 MB. Barra de workload usa o
     commit limit.
   - Validado: LM Studio 20,4 GB commit / 9,8 GB VRAM; ComfyUI 18,8 GB / 3,8 GB.

4. **Sensor precisava ser protegido.** O `pwsh` do sensor aparecia como
   processo ejetável (e o workload que o contém é o do Vitals).
   - Fix: `SensorMeta.sensorPid` + inclusão em `selfPids`.

5. **WARP oculto na UI** quando ocioso (`kind === 'software'` sem uso/VRAM).
   Adaptadores visíveis: NVIDIA + AMD iGPU.

6. **`--json` sujo.** O logger escrevia em stdout junto do JSON.
   - Fix: `VITALS_LOG_SILENT=1` automático no probe com `--json`.
   - Validado: `npx tsx scripts/probe.ts --json` parseia direto.

7. **`killedPids` duplicava** quando o alvo já estava morto: o laço gracioso
   empurrava o PID e o laço final empurrava de novo (mensagem "2 processos").
   - Fix: o laço gracioso ignora PIDs já mortos; a contabilização fica só no
     laço final.
   - Validado via API: gracioso derruba 1; força em PID morto reporta 1.

### Validação

- `npm run typecheck` limpo.
- `npm test`: 7 arquivos, 40 testes.
- `npm run build` ok (copia `windows-sensor.ps1`).
- `npm run probe`: 3 adaptadores, `8C/16T`, workloads ordenados por VRAM.
- UI em `probe:serve`: 2 cartões de GPU, 8 workloads, 40 linhas na tabela,
  16 barras de núcleo, sem erros de console.
  - Screenshot do browser tool falhou ("needs a visible tab"); validação por
    DOM/evaluate.
- JSON: 252 processos, 41 workloads, 0 `cpuPct` nulo, VRAM atribuída ao LUID
  `luid:0x00000000:0x0000CE41`.
- **Ejeção end-to-end** (API, porta 4783, token + remote actions):
  - processo descartável `pwsh -Command Start-Sleep` → `graceful` → `ok=true`,
    `verified=true`, `killed=[pid]`, morto;
  - segundo POST `force` no mesmo PID já morto → `killed=[pid]` (sem
    duplicata), mensagem "1 processo";
  - tentativa em PID inexistente → `allowed=false`, `result=blocked`,
    `origin=api` no `audit.jsonl`.
  - Nenhum workload real (ComfyUI/LM Studio) foi tocado.

### Descobertas

- `python` do ComfyUI usa ~3,1 GB de VRAM dedicada + ~8,9 GB compartilhada;
  `llama-server` 9,8 GB dedicada.
- RAM 95–98% e commit ~90% são o estado normal desta máquina; a saúde fica em
  WARN/CRITICAL quase sempre. O HUD deve mostrar **quem** segura isso.
- Muitos `ppid=-1` são normais (processos de sistema inacessíveis). Os stacks
  de IA têm árvore completa.
- `npm run probe -- --json` inclui banner do npm; documentado usar `npx tsx`.

### Pendências

- Empacotamento (electron-builder).
- Alertas por notificação.
- Teste de parser do sensor com fixture real.
- Classificação UMA da iGPU AMD.
- `git init` + commit inicial (feito nesta sessão, ver histórico do repo).

### Comandos úteis descobertos

```powershell
# primeiro evento do sensor
& "$env:ProgramFiles\PowerShell\7\pwsh.exe" -NoProfile -File src\main\telemetry\sources\windows-sensor.ps1 -IntervalMs 2000 -ParentPid 0

# JSON limpo
npx tsx scripts/probe.ts --json | ConvertFrom-Json

# parar servidor de teste
Get-NetTCPConnection -LocalPort 4780 -State Listen | Select-Object OwningProcess
```
