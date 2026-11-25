# Contrato do item 10: bot do Telegram

**Status: CONTRATO ASSUMIDO PELA SESSÃO (2026-11-23).** O dono saiu e delegou o item 10 inteiro à sessão
Qwen ("aproveite e já faça o item 10 também, não precisa ficar me perguntando nada... vai fundo"). Este
documento substitui a rodada "contrato → aprovação do dono" que os itens 5 a 9 tiveram. Cada decisão abaixo
é NUMA DECISÃO ASSUMIDA, não aprovada: o dono pode trocar qualquer uma depois, e as que têm alternativa
razoável dizem qual era a alternativa. Base: `docs/superpowers/specs/2026-11-23-planejamento-item-10-telegram.md`.

## Escopo

O motor de conversa por rascunhos (itens 2 a 8, incluindo editar/apagar e o limite do cartão da 8d) passa a
funcionar também pelo Telegram, ao lado do app e do WhatsApp. O motor não muda de semântica: o item 10 é
canal — transporte, identidade, travas e formatação.

## Decisões assumidas

### D1 — Pareamento (espelho exato do 5b do WhatsApp)
- Em Configurações > Conta, o usuário gera um **código de vínculo de 8 caracteres** (mesmo alfabeto sem
  caracteres ambíguos, mesma validade de 10 minutos, só o **hash SHA-256** no banco, uso único, gerar novo
  invalida o anterior). O usuário manda o código, do próprio Telegram, para o bot.
- A identidade do dono vem **sempre e só da tabela de vínculo** (`chat.id` → `userId`). Nenhum campo do
  evento do Telegram (`from`, `@username`) define dono, igual à regra do jid no item 5.
- `chat.id` é número grande (BigInt no Prisma). O app mostra o vínculo com o id **mascarado** (primeiro e
  último dígito), nunca o id inteiro.
- Desvincular: pelo cartão do app (DELETE REST) ou escrevendo "desvincular telegram" no chat. Apaga o
  vínculo e a sessão TELEGRAM; a do app fica; eventos permanecem (sem texto).

### D2 — Transporte: LONG POLLING (a decisão mais visível desta sessão)
- **Assumido: long polling com `getUpdates`** em vez de webhook. Motivo principal: o webhook Telegram exige
  host HTTPS público — exatamente o que travou o 5d do WhatsApp. Long polling roda no backend atual sem
  exposição nova de rede, sem segredo de assinatura (a resposta do `getUpdates` já é autenticada pelo token).
- Custo aceito: **exatamente uma instância** do backend deve consumir o polling. Com TELEGRAM_ENABLED=true em
  duas instâncias, as duas leem o mesmo offset e a fila degrada. Deixar isso escrito na release note.
- Offset do polling persistido em banco (tabela de estado com linha única) para não reprocessar após restart.
  Além do offset, a deduplicação de `messageId` do motor (chave `appliedKey`) é a segunda camada.
- O laço roda só com `TELEGRAM_ENABLED=true`, inicia no `onModuleInit`, para no `onModuleDestroy`. Erro de
  rede/Bot API: backoff de 5 s até 60 s, log sem texto. O laço nunca derruba o app.
- Alternativa rejeitada: webhook (dependência de HTTPS público idêntica ao 5d; não vale repetir o bloqueio).

### D3 — Trava de escrita
- Chave própria `TELEGRAM_WRITES_ENABLED`, **padrão `false`**, espelhando `WHATSAPP_WRITES_ENABLED`.
- Com a trava ligada (padrão), "confirmar" pelo Telegram não grava e responde que a confirmação é pelo app
  (texto espelho do `whatsappWritesOff`). O rascunho criado pelo Telegram aparece no app para confirmar pelo
  botão — precedente D9 do item 5, estendido: `getSession` passa a olhar a sessão `TELEGRAM` em
  `AWAITING_CONFIRMATION` depois da do WHATSAPP.

### D4 — Teclado do Telegram (o que a 8d entregou entra aqui)
- Os `quickReplies` do motor viram **reply keyboard** (botões de texto que o Telegram devolve como mensagem)
  exatamente quando o motor os manda: `['confirmar','cancelar']`, `['apagar','cancelar']` e `['limpar','cancelar']`
  dos cartões 8a–8d. Botão tocado chega como texto e cai na mesma máquina de palavras do motor — nenhuma
  semântica nova de callback.
- Inline keyboard (callback) foi a alternativa rejeitada: criaria um segundo caminho de confirmação por
  `callback_query` fora da máquina de texto que os itens 2–8 provaram.
- Em `HELP`, os exemplos vão no texto (linha "Exemplos: ..."), sem teclado.
- Menu de comandos (`setMyCommands`: saldo, gastos, ajuda...) enviado no start do polling, best-effort
  (falha só loga).

### D5 — Mídia
- Foto/documento no chat do Telegram **não** vira importação de nota (item 4 é tela). Resposta orienta a usar
  a tela de Importações do app, mesma texto do WhatsApp. Item próprio no futuro.

### D6 — Anti-abuso (espelho do item 5, mesmos números)
- 20 mensagens/minuto por `chat.id` (acima disso: silêncio); 5 tentativas de código por 10 minutos por
  `chat.id` (contadas **antes** do resgate, INCR atômico); orientação para chat desconhecido no máximo uma por
  hora. Sem Redis, chat desconhecido fica mudo (falha fechada), igual ao WhatsApp.
- Chaves do Redis: `telegram:rate:<sha256(chatId)>`, `telegram:linkfail:...`, `telegram:hint:...`.

### D7 — Privacidade
- O cartão do app mostra o texto de aviso **antes** do botão de gerar código: o bot usa a **Bot API oficial**
  (diferença real contra o WhatsApp não-oficial do 5), o Lumen nunca manda mensagem proativa, e a troca fica
  no canal + eventos sem texto no Lumen.
- Logs: só `chat.id` mascarado, nomes de erro, status HTTP; nunca texto de mensagem, código, ou token.

### D8 — Dependência: Bot API crua via fetch (sem grammY)
- Módulo fino `TelegramBotClient` (getUpdates, sendMessage, setMyCommands) sobre `fetch` nativo, `redirect:
  'manual'` (não vaza o token em redirecionamento), `AbortSignal.timeout`, erro sem corpo. Padrão do
  `WaAkgClient`. `TELEGRAM_BASE_URL` configurável existe **para os testes** (Bot API falsa local) e para
  proxies; o padrão é `https://api.telegram.org`.
- URL com token (`.../bot<token>/método`): o token só existe na env; nenhum log carrega a URL.

## Banco (migration aditiva `20261123190000_telegram`)
- `enum ConversationChannel` ganha `TELEGRAM` (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`, o mesmo padrão da
  migration do enum do item 7).
- `TelegramLink` (`userId @unique`, `chatId BigInt @unique`), `TelegramLinkCode` (igual à do WhatsApp),
  `TelegramBotState` (linha única `poll` com `lastUpdateId BigInt`).

## Variáveis de ambiente (nomes; valores nunca no repositório)
`TELEGRAM_ENABLED` (false), `TELEGRAM_WRITES_ENABLED` (false), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BASE_URL`
(default `https://api.telegram.org`), `TELEGRAM_TIMEOUT_MS` (default 8000; o pedido de long polling usa o
timeout do próprio Telegram e o da request fica acima dele), `TELEGRAM_POLL_TIMEOUT_S` (default 25).
Com `TELEGRAM_ENABLED=true` e `TELEGRAM_BOT_TOKEN` ausente, o backend **recusa subir** listando o nome
(espelho do `onModuleInit` do WhatsApp).

## Fatiamento (fechado por fatia, tag no fim do item)
- **10a (backend)**: enum + tabelas, `TelegramBotClient`, `TelegramLinkService` (código/par/rede/status/
  desvincular), `TelegramAdapterService` (laço de polling, limites, pareamento, rota para `handleMessage`
  com `channel: 'TELEGRAM'`, teclado, envio em partes), controller REST (`POST /telegram/link-code`,
  `GET /telegram/status`, `DELETE /telegram/link`), trava D3 no motor, `getSession` com TELEGRAM. Testes no
  padrão do WhatsApp (fakes de Prisma, client com fetch falso), mutantes, integração com Bot API falsa local.
- **10b (app)**: cartão "Telegram" em Configurações (espelho do cartão WhatsApp da 5b) + serviço.
- **10c (fechamento)**: integração real com Bot API falsa cobrindo o fluxo de polling de ponta a ponta,
  bateria de mutantes da fatia, nota de release e tag `v1.16.0`.

## O que fica explicitamente FORA do item 10
- Foto→nota fiscal (D5), webhook HTTPS (alternativa de D2), multi-instância do polling, `callback_query`,
  grupos (só chat privado: `chat.type !== 'private'` é descartado em silêncio), idioma do bot (pt-BR fixo).
