# Worklog

Registro cronológico do que foi feito e do que foi aprendido. **Toda sessão de
agente termina com uma entrada aqui.** Mais recente no topo.

Formato: data, objetivo, mudanças, descobertas, validação, pendências.

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
