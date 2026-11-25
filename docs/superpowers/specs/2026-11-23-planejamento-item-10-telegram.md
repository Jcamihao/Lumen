# Planejamento do item 10: bot do Telegram ao lado do WhatsApp

**Status: PLANEJAMENTO (pedido pelo dono em 2026-11-23) — NÃO é contrato.** Ninguém implementa nada daqui
sem o contrato rascunhado e as decisões aprovadas pelo dono, como foi feito nos itens 5 a 9.

## 1. O que o dono pediu

O manual de finanças por conversa (motor de rascunhos, confirmar/cancelar, apagar, etc.), hoje acessível
pelo app e pelo WhatsApp (WA-AKG), deve ficar disponível também pelo **Telegram**, com as duas opções
coexistindo: o usuário escolhe um, os dois, ou migra.

## 2. Por que o custo é menor que o do item 5 (fatos lidos no código em 2026-11-23)

- O motor (`ConversationService.handleMessage`) já é **canal-agnóstico**: recebe `ConversationInput`
  (`userId`, `channel`, `messageId`, `text`, `receivedAt`) e nunca fala HTTP. Um canal novo é adaptador +
  identidade, não motor.
- `ConversationChannel` é enum no Prisma (`APP`, `WHATSAPP`); adicionar `TELEGRAM` é migration aditiva.
- A confirmação pelo botão do app já atravessa canal (D9 do item 5: `getSession` devolve rascunho do
  WhatsApp para confirmar no app) — vale igual para Telegram.
- Trava de escrita por canal (`whatsapp.writesEnabled`), isolamento de dono (item 6), fallback de IA
  (item 7), entitlements e eventos por `messageId` são reusáveis sem mudança de semântica.
- Os itens 8a–8d (editar/apagar/limite) são texto no mesmo motor: chegam grátis no Telegram.

## 3. Decisões a resolver no contrato (numeradas para levar ao dono)

- **D1 — pareamento**: como um chat do Telegram vira um usuário Lumen (código de link gerado na tela de
  Configurações, como a 5b fez com número de WhatsApp; Telegram expõe `chat.id` e `@username`).
- **D2 — transporte**: webhook HTTPS da Bot API (mesma dependência de host HTTPS do 5d) **ou** long polling
  (não exige host público; exige exatamente uma instância consumindo). Pesquisar o custo real antes.
- **D3 — trava de escrita**: chave própria `TELEGRAM_WRITES_ENABLED`, espelhando a do WhatsApp.
- **D4 — quick replies**: mapear `quickReplies`/cartões (Confirmar, Apagar de vez, limpar) para a keyboard
  de resposta do Telegram; menu de comandos via BotFather.
- **D5 — mídia**: foto mandada no chat virar importação de nota (item 4 é só tela hoje)? Recomendo deixar
  fora do 10 e tratar como item próprio.
- **D6 — anti-abuso**: rate limit e o que fazer com chat id de desconhecido (o bot é público por natureza).
- **D7 — privacidade**: texto de consentimento/privacidade do canal (o app já tem `privacyNoticeAccepted`).
- **D8 — dependência**: chamadas diretas à Bot API via fetch/axios (padrão do WA-AKG, sem lib nova)
  **ou** grammY. Recomendo a primeira, com um módulo fino de transporte para testar com servidor falso.

## 4. Fatiamento provisório

- **10a**: backend — enum `TELEGRAM`, módulo de transporte (Bot API falsa nos testes), pareamento D1,
  travas D3/D6, roteamento para `handleMessage`, eventos e isolamento iguais ao WhatsApp.
- **10b**: app — Configurações ganha "Conectar Telegram" (espelho da tela da 5b), com código de link.
- **10c**: integração real com bot de teste do dono + nota de release (v1.10.0?, decidir na hora).

## 5. Ordem

Depois do 8d (última ponta do item 8, em andamento) e a critério do dono em relação à 9b (bot conhece os
cartões) — a 9b é motor (texto puro) e o 10 é canal: são independentes, quem andar primeiro não atrapalha.
