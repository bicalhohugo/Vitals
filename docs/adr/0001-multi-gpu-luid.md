# ADR-0001 — Multi-GPU por LUID (schema 2)

**Data:** 2026-10-30
**Status:** aceito

## Contexto

A máquina tem três adaptadores (RTX 5060 Ti, iGPU AMD, WARP). O schema 1
assumia uma GPU só e misturava telemetria de fontes diferentes. Precisávamos
atribuir uso e VRAM por processo ao adaptador correto — o operador quer saber
qual GPU o ComfyUI está enchendo.

Os contadores de performance do Windows (`GPU Engine`, `GPU Process Memory`,
`GPU Adapter Memory`) identificam o adaptador pelo **LUID**
(`luid_0x00000000_0x0000CE41`). `nvidia-smi` não expõe LUID.

## Decisão

- `GpuAdapter[]` com `id = "luid:0xHIGH:0xLOW"`.
- O sensor nomeia cada LUID via DXGI (`EnumAdapters1`/`GetDesc1`).
- Processos referenciam adaptadores por `gpuAdapters: string[]`.
- `primaryGpuId` = adaptador com maior `vramTotalMiB`.
- Telemetria NVIDIA é fundida por nome normalizado, não por índice.

## Consequências

- Atribuição exata, inclusive iGPU e WARP.
- IDs estáveis entre ticks e reinícios do app (LUID é estável enquanto o
  driver não reinicia).
- `nvidia-smi` sozinho (sensor morto) produz `id: nvidia:0`, sem processos.
- O renderer não pode assumir "gpu[0] é a principal": use `primaryGpuId`.

## Alternativas descartadas

- Índice de adaptador: muda com hot-plug e não casa com contadores.
- Nome: nomes duplicados (duas GPUs iguais) e nomes localizados.
- WMI `Win32_VideoController`: sem LUID e sem uso por processo.
