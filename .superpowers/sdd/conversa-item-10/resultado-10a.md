# Item 10a — Bot do Telegram (backend) — resultado

Ramo: `feat/telegram-10a` (a partir do contrato 850e556). Contrato: `docs/superpowers/specs/2026-11-23-conversa-contrato-item-10.md` (D1–D8 assumidos pela sessão por delegação do dono).

## O que entrou

- **Schema/migração**: enum `ConversationChannel.TELEGRAM`; modelos `TelegramLink` (chatId BigInt único → userId), `TelegramLinkCode` (só hash do código, expiração, tentativas) e `TelegramBotState` (linha `poll` com `lastUpdateId` BigInt). Migração `20261123190000_telegram` aplicada limpa e conferida com `migrate diff` (SEM_DRIFT).
- **`backend/src/telegram/`** (módulo novo, 7 arquivos + 4 specs):
  - `telegram.config.ts` — `TELEGRAM_ENABLED` / `TELEGRAM_WRITES_ENABLED` / `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BASE_URL` (D8: testável com Bot API falsa) / `TELEGRAM_TIMEOUT_MS` / `TELEGRAM_POLL_TIMEOUT_S`.
  - `telegram-bot.client.ts` — Bot API via fetch cru: `getUpdates`, `sendMessage` (HTML), `setMyCommands`, `getMe`; `parseTelegramUpdate` valida e normaliza (chatId/string, messageId `tg-<id>`, `hasText`).
  - `telegram-adapter.service.ts` — laço de long polling (D2) iniciado no `onModuleInit` só com canal ligado; offset persistido por lote (inclusive updates descartados); backoff 5s→60s em erro de rede sem derrubar o resto; pareamento espelhando 5b (D1: código 8 caracteres, hash-only, chat nunca é autoridade, D6: 20 msgs/min, 5 códigos errados/10min, 1 orientação/h, falha fechada sem Redis); comando "desvincular telegram" tolerando caixa/espaços; 1000 chars máx.; reentrega tratada por DUPLICATE do motor (não reenvia); envio em partes com teclado só na última (D4); mídia → orientação da tela de Importações (D5).
  - `telegram-format.ts` — HTML com escape total, corte em até 4 partes de 3500 com prioridade a quebra de linha, exceção final `…`; teclado `confirmar/cancelar` só em rascunho aguardando confirmação.
  - `telegram-link.service.ts` — pareamento reaproveitando o alfabeto/normalização/hash do WhatsApp; status com chat mascarado (D7).
  - `telegram-mask.ts` — `98••••••10`; chat.id inteiro nunca sai do banco.
  - `telegram.controller.ts` — `POST /telegram/link-code`, `GET /telegram/status` (com `botUsername` via `getMe`), `DELETE /telegram/link`.
- **Motor de conversa**: gate de escrita estendido (D3: confirmar pelo Telegram com `TELEGRAM_WRITES_ENABLED=false` responde "confirme no app" e nada grava; app continua gravando) e `getSession` passa a exposição do rascunho TELEGRAM após o do WhatsApp (D9: app vê e confirma pelo botão).
- **`.env.example`**: bloco TELEGRAM_* com os padrões (escrita desligada por padrão).

## Verificação

- `tsc --noEmit` limpo; `nest build` ok.
- suíte do módulo: **54 testes** (4 specs); suíte completa do backend: **85 suítes / 2123 testes** (eram 2119 + 4 novos mata-mutantes).
- Motor + telegram em 3 fusos (America/Sao_Paulo, UTC, Asia/Tokyo): **856 testes** verdes em cada.
- Estabilidade do módulo: 15 execuções seguidas, 0 falhas.
- **Caçada a mutantes**: 10 mutantes no núcleo (offset do getUpdates, rate `>20`, falha fechada sem Redis, linkfail `>5`, hint 1/h, DUPLICATE, teclado só na última parte, teclado sem rascunho, corte de parte, máscara). **9 mortos + 1 equivalente** (reenvio de DUPLICATE: texto do DUPLICATE é vazio, `splitIntoParts('')` não gera partes e nada seria enviado de qualquer forma). Para matar os 4 sobreviventes da primeira rodada entraram 4 testes novos: 20ª mensagem processada, 5ª tentativa validada, teclado só na última de várias partes, quebra na posição 0 não corta.
- **Integração real** (`/tmp/opencode/integracao-10a.mjs`, 2 execuções × **28 checks, 0 falhas**): Bot API falsa local + backend real + PG 18 e Redis descartáveis. Cobre: pareamento por código com status mascarado, conversa com pergunta de categoria, teclado na última parte, trava D3 sem gravar, app vê e grava o rascunho do Telegram (D9), reentrega do mesmo update não responde, 1 orientação/h por chat, rajada de 25 silencia após o limite, **retomada do offset entre restarts** (D2) e gravação pelo chat com escrita ligada, desvincular pelo chat, vínculo e sessão do B isolados de A.

## Notas de execução

- Todos os insucessos da integração nas primeiras execuções eram do ambiente do teste (offset/`TelegramLink`/janelas de rate residuais entre execuções), não do produto; o script now começa de banco Telegram truncado, Redis limpo e sem backend órfão na porta.
- Caveat registrado no contrato: exatamente **uma instância** do backend deve consumir o polling (offset em linha única).
- Produto sem mudanças pendentes; nada de segredo real no caminho (token só via env).
