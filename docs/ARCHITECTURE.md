# Arquitetura

## Visão em uma tela

```
┌──────────────────────────── Electron main ────────────────────────────┐
│                                                                      │
│  TelemetryEngine (tick a cada VITALS_SAMPLE_MS)                      │
│    ├─ WindowsSensor ── spawn pwsh windows-sensor.ps1 ── GPU/VRAM/proc │
│    │                     ├─ DXGI (nomes, LUID, kind)                  │
│    │                     ├─ contadores GPU Engine / Adapter Memory    │
│    │                     └─ NtQueryInformationProcess (ppid)          │
│    ├─ NvidiaSampler ── nvidia-smi (temp, W, clock, fan, VRAM)        │
│    ├─ PortsSource ── netstat -ano (porta → pid)                       │
│    ├─ StorageSource ── volumes                                       │
│    └─ buildProcessRows → buildWorkloads → evaluateHealth → Snapshot  │
│                                                                      │
│  ActionService ── policy → taskkill → verifica → audit.jsonl         │
│  VitalsHttpServer ── /api/* + SSE + estáticos (127.0.0.1)            │
└───────────────┬──────────────────────────────────────────────────────┘
                │ IPC (window.vitals)          ou      HTTP + SSE
        ┌───────▼────────┐                    ┌───────────────┐
        │  Preload seguro│                    │  Navegador    │
        └───────┬────────┘                    └───────┬───────┘
                └──────────► React renderer ◄─────────┘
```

O renderer não conhece fonte de dados: `src/renderer/src/api.ts` usa
`window.vitals` quando existe (Electron) e cai para `/api/snapshot` +
`EventSource('/api/events')` quando aberto no navegador.

## O laço de telemetria

`TelemetryEngine.start()`:

1. Sobe o sensor PowerShell (assíncrono; `Add-Type` leva ~4 s).
2. Sobe `nvidia-smi` (se existir).
3. Executa `tick()` imediatamente e agenda a cada `intervalMs`.
4. `netstat` roda em timer próprio (`VITALS_PORTS_MS`).

Cada `tick()`:

- pega o último `SensorTick` e o `SensorMeta`;
- forma `selfPids` (Electron + processo do sensor);
- **se o `seq` do sensor mudou**, recalcula linhas e workloads; senão
  reaproveita as anteriores (importante: CPU% é delta — recalcular sobre a
  mesma amostra zera tudo);
- monta adaptadores (`buildGpus`), snapshot, histórico (`RingBuffer`),
  saúde (`evaluateHealth`) e emite `snapshot` (IPC/SSE).

O snapshot é imutável do ponto de vista do renderer.

## Sensor PowerShell

`src/main/telemetry/sources/windows-sensor.ps1` é o único coletor nativo. Ele:

- compila um bloco C# (`Add-Type`) com:
  - `CreateDXGIFactory1` + `EnumAdapters1`/`GetDesc1` → nome, LUID, vendor,
    memória dedicada/compartilhada;
  - `OpenProcess` + `NtQueryInformationProcess(ProcessBasicInformation)` →
    `ppid` (o WMI não dá pai de tudo e é lento);
- abre contadores de performance:
  - `GPU Engine(*)\Utilization Percentage` (por pid+luid+engine);
  - `GPU Process Memory(*)\Dedicated Usage` / `Shared Usage` (por pid+luid);
  - `GPU Adapter Memory(*)\Dedicated Usage` / `Shared Usage` (por luid);
- lê `Win32_Processor` (cores/threads) e commit charge
  (`Win32_OperatingSystem.TotalVirtualMemorySize/FreeVirtualMemory`);
- emite **uma linha JSON por evento**: `hello` no início e `tick` a cada
  intervalo;
- tem watchdog: reinicia se travar, e sai se o processo pai morrer
  (`-ParentPid`).

O TypeScript (`windows-sensor.ts`) spawna `pwsh -File`, lê stdout por linhas,
faz parse, guarda `lastSeq`/`lastUpdate` e expõe `status`:
`starting | live | stale | unavailable`.

O `.ps1` é lido **do disco** (não `?raw`) e o `npm run build` copia para
`out/main`. Assim `tsx` (probe) e o app empacotado usam o mesmo arquivo.

### Por que LUID

O Windows identifica adaptadores por LUID (`0xHIGH:0xLOW`). Os contadores
`GPU Engine` trazem o LUID no nome da instância. O sensor nomeia cada LUID via
DXGI, então a atribuição por processo é exata — inclusive para a iGPU e para
WARP. `nvidia-smi` não expõe LUID; por isso a telemetria NVIDIA é casada pelo
**nome normalizado** do adaptador.

## GPU no snapshot

`buildGpus`:

- se o sensor está indisponível, usa só `nvidia-smi` (`id: nvidia:0`, sem
  processos);
- se está vivo, cria um `GpuAdapter` por LUID, com uso/VRAM por adaptador e a
  lista de processos daquele LUID;
- funde a telemetria NVIDIA quando `vendor === 'nvidia'` e o nome normalizado
  casa (temperatura, potência, clocks, fan, VRAM total do `nvidia-smi`);
- escolhe `primaryGpuId` pelo maior `vramTotalMiB` (na prática, a dGPU).

Processos aparecem em `ProcessRow.gpuAdapters` (ids `luid:...`), somando
`vramMiB` dedicada e `sharedVramMiB`.

## Workloads

Duas camadas:

1. **Árvore** (`src/main/telemetry/workloads.ts`): para cada processo, sobe a
   cadeia de `ppid` até o primeiro ancestral que seja *container* (explorer,
   svchost, shells, etc.). Esse nó vira a âncora. Filhos de *service hosts*
   (`SYSTEM_HOST_NAMES`) não viram workloads — são serviços.
2. **Regras** (`src/shared/workloads.ts`): o nome/caminho da âncora é casado
   com `WORKLOAD_RULES` para ganhar label e tipo (`ComfyUI`, `LM Studio`,
   `Morpheus / TTS`, `OpenCode`, `Navegador`, `Terminal`).

O workload agrega CPU, commit privado, VRAM, portas e contagem de processos.
A ordenação é **VRAM desc, depois commit privado desc** — o que aperta a
máquina primeiro.

Portas vêm do `netstat -ano` e são anexadas ao workload do pid dono.

## Ejeção

```
UI/HTTP → ActionService.terminate|terminateWorkload
        → policy.ts (nega por padrão; protege kernel/self/serviços)
        → taskkill /PID  (gracioso)
        → espera gracefulTimeoutMs
        → se mode=force: taskkill /PID root /F /T + /F por pid
        → verifica se os PIDs morreram
        → mede VRAM antes/depois
        → AuditLog.append (sempre, inclusive bloqueio)
```

`ActionService` é o único ponto do projeto que executa encerramento. A UI
apenas monta um `KillTarget` e abre o `KillDialog`.

## Saúde

`evaluateHealth` combina:

- RAM física (`memory.usagePct`) — warn 88, crit 95;
- **commit charge** (`commitPct`) — warn 85, crit 94 (no Windows ele estoura
  antes da RAM);
- VRAM do primário — warn 90, crit 97;
- temperatura da GPU — warn 83 °C, crit 90 °C;
- CPU média dos últimos 5 pontos — warn 85, crit 95;
- estado das fontes (sensor/nvidia).

Retorna `ok | warn | critical` + até 5 motivos em pt-BR.

## Histórico

`RingBuffer` por série (`cpu`, `gpu`, `vramMiB`, `ram`, `commit`), com
`VITALS_HISTORY_POINTS` pontos. O snapshot carrega o histórico completo; a API
permite fatiar por `?points=`.

## Decisões que não são óbvias

- **Commit privado, não RSS** (ADR-0005).
- **LUID como chave de adaptador** (ADR-0001).
- **Workload = árvore + regra**, não só nome de processo (ADR-0002).
- **Gracioso primeiro, força explícita** (ADR-0003).
- **Sensor em PowerShell** em vez de módulo nativo (ADR-0004).
