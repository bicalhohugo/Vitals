# Segurança

O Vitals encerra processos. Este documento diz o que ele pode fazer, o que
não pode, e onde estão os riscos residuais.

## Modelo de ameaça

- **Alvo:** uma máquina Windows de operador único, na rede local.
- **Ator legítimo:** o operador na sessão interativa e agentes rodando na
  mesma máquina.
- **Riscos que importam:**
  1. encerrar o processo errado por engano (PID reciclado, clique errado);
  2. derrubar um serviço crítico e perder a sessão/rede;
  3. uma página web local ou outro processo disparar uma ejeção;
  4. perder a trilha de quem matou o quê.
- **Fora de escopo:** atacante com admin local (pode matar tudo e editar a
  auditoria), malware kernel-mode, isolamento multi-tenant.

## Barreiras

### 1. Política nega por padrão

`src/main/actions/policy.ts` é a única autoridade. Ela recusa:

- `VITALS_ACTIONS=0`;
- PID inválido ou de kernel (`<= 4`);
- processo inexistente na amostra atual;
- o próprio Vitals (`isSelf`);
- processos em `PROTECTED_PROCESS_NAMES`;
- PID reciclado (`expectedStartedAt` diferente);
- workload vazio, protegido ou que contenha o Vitals;
- workload com qualquer membro protegido.

Nada em `policy.ts` executa efeito colateral: é pura e testada (20 casos em
`tests/policy.test.ts`).

### 2. Lista de proteção

`src/shared/protection.ts` inclui kernel, sessão, serviços essenciais, Defender
(`msmpeng`, `nissrv`, `securityhealthservice`), `explorer`, `dwm`, entre
outros. O processo do **sensor PowerShell** também entra em `selfPids`, então
não pode ser ejetado pela tabela.

Mudar essa lista exige ADR e teste. Em dúvida, **não** remova.

### 3. Gracioso primeiro, força explícita

- `mode: "graceful"` → `taskkill /PID` (sem `/F`), espera
  `VITALS_GRACEFUL_TIMEOUT_MS`;
- se sobreviver, o resultado vem com `needsForce: true` e a UI pede
  confirmação;
- `mode: "force"` → `taskkill /PID <root> /F /T` e `/F` por PID restante.

Não existe caminho de código que force sem `mode: "force"` explícito.

### 4. Guarda de reuso de PID

A UI envia `expectedStartedAt` (epoch ms). Se o processo atual tiver outro
`startedAt`, a política recusa. Isso fecha a janela entre "vi o PID na tela" e
"cliquei em ejetar".

### 5. API local

- Escuta **somente** `127.0.0.1` (hardcoded em `config.ts`).
- Leitura (`GET`) é aberta a processos locais.
- Escrita (`POST /api/terminate`) exige:
  - `VITALS_REMOTE_ACTIONS=1`, **e**
  - `VITALS_HTTP_TOKEN` com >= 16 caracteres.
- Token aceito em `Authorization: Bearer ...` ou `x-vitals-token`.
  Comparação com `timingSafeEqual`.
- Sem CORS: um site aberto no navegador não consegue ler as respostas. O token
  impede POSTs cegos.
- Erros não vazam o token.

### 6. Auditoria

Toda tentativa — sucesso, falha ou bloqueio — é anexada a
`audit.jsonl` com origem (`ui`, `api`, `cli`), modo, PIDs, duração, VRAM antes
e depois, e motivo. A UI mostra as entradas recentes no rail.

## Riscos residuais (aceitos)

| Risco | Mitigação atual | Comentário |
| --- | --- | --- |
| Token em HTTP claro no loopback | rede local, loopback | qualquer processo local pode ler `.env`; trate o token como senha local |
| Qualquer processo local lê `/api/snapshot` | nenhuma | dados operacionais, não segredos |
| Admin local apaga `audit.jsonl` | nenhuma | fora de escopo; para isso, envie o JSONL para fora |
| `taskkill` pode ser bloqueado por antivírus/EDR | resultado reporta falha | não insista em loop |
| Elevação necessária para serviços | `requiresElevation` no resultado | o Vitals **não** se auto-eleva |
| iGPU AMD classificada como discreta | cosmético | ver DATA-SOURCES |
| Contadores localizados | erro em `hello.errors` | ajustar nomes no `.ps1` |

## O que o Vitals nunca faz

- Não abre porta fora de loopback.
- Não se eleva sozinho (`runas`/UAC).
- Não mata por padrão de nome "suspeito" (sem heurística de malware).
- Não executa comandos arbitrários: só `taskkill` com PIDs validados.
- Não persiste o snapshot nem dados de processos em disco (só log e auditoria).
- Não envia nada para a rede.

## Checklist antes de liberar uma mudança que toca ações

- [ ] `policy.ts` continua negando por padrão.
- [ ] Nenhum caminho novo usa `/F` sem `mode: "force"`.
- [ ] `expectedStartedAt` continua sendo checado.
- [ ] Tentativas bloqueadas continuam auditadas.
- [ ] `tests/policy.test.ts` e `tests/terminate` (se existir) verdes.
- [ ] ADR se a lista de proteção mudou.
