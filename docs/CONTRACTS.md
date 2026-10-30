# Contratos

Tudo que atravessa `main ↔ renderer ↔ API HTTP` é contrato. Mudou
`src/shared/types.ts`? Atualize este documento **no mesmo commit**.

Versão atual: **schema 2** (`Snapshot.schema === 2`).

## Regras de evolução

- Campos novos são **aditivos** e opcionais para consumidores antigos.
- Remover/renomear campo, mudar unidade ou semântica = quebra → incremente
  `schema`, registre um ADR e atualize probe/UI/testes.
- Unidades: bytes em campos `*Bytes`; MiB em campos `*MiB`; percentuais 0–100.
- Tempos são `number` em milissegundos desde a época Unix (UTC).
- `null` significa "desconhecido", nunca zero.

## Snapshot

```ts
interface Snapshot {
  schema: 2
  ts: number
  seq: number
  host: HostInfo
  cpu: CpuSample
  memory: MemorySample
  gpus: GpuAdapter[]
  primaryGpuId: string | null
  processes: ProcessRow[]
  workloads: Workload[]
  volumes: VolumeInfo[]
  history: HistorySeries
  health: HealthInfo
  sources: SnapshotSources
}
```

| Campo | Semântica |
| --- | --- |
| `seq` | Incrementa a cada tick do motor. Use para descartar snapshot velho. |
| `host.cores` | Núcleos **físicos** (sensor); fallback `os.cpus().length`. |
| `host.threads` | Núcleos lógicos. |
| `cpu.usagePct` | Capacidade total da máquina (0–100), como no Gerenciador de Tarefas. |
| `cpu.perCorePct` | Um valor por núcleo lógico. |
| `memory.usedBytes` | RAM física em uso. |
| `memory.commitPct` | `committed / limit * 100`. **Sinal primário de pressão.** |
| `primaryGpuId` | `id` do adaptador principal (maior VRAM). |
| `sources` | Estado de cada fonte (`live/stale/unavailable/disabled`). |

### GpuAdapter

```ts
{
  id: 'luid:0x00000000:0x0000CE41',
  luid: '0x00000000:0x0000CE41',
  name: 'NVIDIA GeForce RTX 5060 Ti',
  vendor: 'nvidia' | 'amd' | 'intel' | 'microsoft' | 'other',
  kind: 'discrete' | 'integrated' | 'software',
  driver: string | null,
  telemetry: 'nvidia-smi' | 'windows-counters',
  vramTotalMiB, vramUsedMiB, vramFreeMiB, sharedUsedMiB,
  utilPct, utilByEngine: Record<string, number>,
  memUtilPct, tempC, powerW, powerLimitW, clockSmMhz, clockMemMhz, fanPct,
  processes: GpuProcessInfo[]
}
```

- `id` é estável e inclui o LUID. Use-o como chave.
- `processes` só inclui quem tem VRAM ou utilização > 0 naquele LUID.
- `kind: 'software'` = WARP. A UI esconde quando ocioso.

### ProcessRow

```ts
{
  pid, ppid, name, path,
  cpuPct: number | null,      // null no primeiro tick (sem delta)
  cpuTimeSec: number | null,  // tempo de CPU acumulado
  rssBytes,                   // working set (não use para "RAM")
  privateBytes,               // commit privado (use este)
  vramMiB, sharedVramMiB,
  gpuUtilPct: number | null,
  gpuAdapters: string[],      // ids de GpuAdapter
  threads, startedAt,
  isProtected, isSelf,
  workloadId: string | null
}
```

`ppid = -1` significa "não foi possível obter" (processo protegido/saindo).

### Workload

```ts
{
  id: 'wl:<rootPid>' | 'rule:<ruleId>',
  label, kind, rootPid, pids[], processCount,
  ports: number[],            // TCP em LISTENING
  cpuPct, rssBytes, privateBytes,
  vramMiB, sharedVramMiB, gpuUtilPct, adapters[],
  startedAt, isProtected, isSelf
}
```

`id` é a unidade de ejeção. `rootPid` é o processo âncora (primeiro
descendente de um container). `pids` inclui a árvore inteira.

### HealthInfo

```ts
{ status: 'ok' | 'warn' | 'critical' | 'unknown', reasons: string[] }
```

Limites padrão: RAM 88/95, commit 85/94, VRAM 90/97, CPU 85/95, GPU 83/90 °C.

## API HTTP

Base: `http://127.0.0.1:4780` (configurável por `VITALS_HTTP_PORT`). Escuta
**apenas** loopback.

| Método | Rota | Resposta |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, schema, uptimeSec, ts }` |
| GET | `/api/snapshot` | `Snapshot` (503 se ainda não há amostra) |
| GET | `/api/history?series=all&points=N` | `HistorySeries` |
| GET | `/api/runtime` | `RuntimeInfo` |
| GET | `/api/audit?limit=50` | `AuditEntry[]` (mais recente primeiro) |
| GET | `/api/events` | SSE; cada `data:` é um `Snapshot` |
| POST | `/api/terminate` | `TerminateResult` |
| GET | `/*` | Estáticos do renderer (`index.html` como fallback) |

### POST /api/terminate

Exige **as duas coisas**: `VITALS_REMOTE_ACTIONS=1` e
`VITALS_HTTP_TOKEN` com >= 16 caracteres.

```http
POST /api/terminate
Authorization: Bearer <token>
Content-Type: application/json

{ "pid": 13740, "mode": "graceful", "expectedStartedAt": 1730000000000 }
```

ou

```json
{ "workloadId": "wl:18252", "mode": "force" }
```

- Header alternativo: `x-vitals-token: <token>`.
- `mode` ausente/inválido → `graceful` (nunca força por omissão).
- `200` quando `ok`, `409` quando bloqueado/falhou (o corpo é o
  `TerminateResult` com o motivo), `401` sem token, `403` com ações remotas
  desligadas, `400` corpo inválido.

## SSE

```
retry: 2000

data: {"schema":2,...}
```

O servidor envia o snapshot atual ao conectar e um por tick. Não há evento
nomeado; use `onmessage`.

## Auditoria

Arquivo: `<VITALS_LOG_DIR>/audit.jsonl` (uma linha JSON por tentativa,
inclusive bloqueios). Em memória, ring de 300 entradas.

```ts
interface AuditEntry {
  id: 'aud_...'
  ts: number
  action: 'terminate' | 'terminate-workload'
  targetKind: 'process' | 'workload'
  targetId: string
  targetLabel: string
  mode: 'graceful' | 'force'
  origin: 'ui' | 'api' | 'cli'
  allowed: boolean
  reason: string | null
  result: 'success' | 'failed' | 'blocked'
  message: string
  pids: number[]
  durationMs: number
  vramBeforeMiB: number | null
  vramAfterMiB: number | null
}
```

Nunca apague/rotacione sem avisar: é a trilha de responsabilidade.

## IPC

| Canal | Direção | Payload |
| --- | --- | --- |
| `vitals:get-snapshot` | invoke | → `Snapshot` |
| `vitals:snapshot` | main → renderer | `Snapshot` |
| `vitals:terminate` | invoke | `TerminateRequest` → `TerminateResult` |
| `vitals:terminate-workload` | invoke | `TerminateWorkloadRequest` → `TerminateResult` |
| `vitals:get-audit` | invoke | `number?` → `AuditEntry[]` |
| `vitals:get-runtime` | invoke | → `RuntimeInfo` |

`contextIsolation: true`, `nodeIntegration: false`. O preload expõe só
`window.vitals`; nada de `ipcRenderer` cru.
