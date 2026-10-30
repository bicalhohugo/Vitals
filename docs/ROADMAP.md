# Roadmap

## Feito (v0.1)

- [x] Schema 2: multi-GPU por LUID, workloads, commit, ppid.
- [x] Sensor PowerShell com DXGI, contadores GPU por processo e watchdog.
- [x] Merge `nvidia-smi` por nome normalizado.
- [x] Workloads por árvore + regras (ComfyUI, LM Studio, Morpheus, OpenCode…).
- [x] Portas via `netstat`.
- [x] Ejeção graciosa/força com política, verificação e auditoria JSONL.
- [x] UI de console (GPU, workloads, processos, rail, histórico).
- [x] API REST + SSE + token para ações remotas.
- [x] `doctor`, `probe` (texto/JSON/serve), 40 testes, build copiando assets.
- [x] Lançador Windows (`Vitals.bat`) com instalação/build sob demanda.
- [x] Executável portátil (`npm run dist`), ícone e `.env` ao lado do `.exe`.
- [x] Instalador NSIS por usuário com atalhos no Desktop e Menu Iniciar.
- [x] Bandeja do sistema: fechar esconde, menu com saúde/logs e **Sair**.
- [x] Documentação completa e worklog.

## Próximo (v0.2)

- [ ] **Assinatura de código**. Portátil e instalador já saem prontos; falta
      certificado para eliminar o SmartScreen (ver OPERATIONS).
- [ ] **Janela always-on-top opcional**, para deixar o HUD num segundo monitor.
- [ ] **Alertas**: notificação do Windows quando commit/VRAM cruzam o limite
      por N amostras (hoje é só cor).
- [ ] **Histórico por workload**: mini-sparkline de VRAM/commit nas últimas
      2 min; hoje o histórico é global.
- [ ] **Ação "ejetar e reiniciar"** para ComfyUI/LM Studio, se o operador
      cadastrar o comando de start.
- [ ] **Classificação correta da iGPU AMD** (UMA) sem hack de tamanho.
- [ ] **Testes de integração do sensor**: fixture do JSON real + teste do
      parser de `hello`/`tick` (hoje o parser é validado só ao vivo).
- [ ] **`theme` claro?** Não é prioridade; o produto é console escuro.

## Backlog

- [ ] Testar portátil/instalador em uma máquina limpa (sem Node, sem `pwsh`).
- [ ] Suporte a múltiplas máquinas (um HUD agregando sensores via HTTP).
- [ ] Persistir histórico em SQLite (hoje ring em memória).
- [ ] Perfil de thresholds por máquina (`.env` ou JSON).
- [ ] Detectar "workload travado": CPU ~0, VRAM presa, sem progresso.
- [ ] Integração com o supervisor do Morpheus para reiniciar Kokoro/Chatterbox.
- [ ] Modo "só leitura" para visitantes (token de leitura separado).
- [ ] Auto-update.
- [ ] Localização dos contadores (en/pt) no sensor.

## Fora de escopo

- Gerenciar máquinas Linux/macOS.
- Matar processos por heurística de malware.
- Substituir Task Manager para uso geral.
- Telemetria na nuvem.
