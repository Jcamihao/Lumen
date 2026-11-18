# Contrato do item 5: adaptador de WhatsApp (via WA-AKG) no motor de conversa

Data: 2026-11-18. Status: **rascunho, aguardando aprovação do dono.** Nenhum código foi escrito. Branch de trabalho: `feat/whatsapp-adapter` (base `develop`).

Fonte da ordem de trabalho: `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md`, seção "Ordem de implementação", item 5 ("Conectar o adaptador WhatsApp ao mesmo motor, com vínculo de conta e revisão por link"), e `docs/superpowers/plans/2026-11-14-assistente-manual-importacao-planos.md`, Fase 3.

Convenção: **Verificado** = li o código ou a documentação. **Presumido** = ainda precisa ser provado.

## 1. Objetivo

Permitir que o usuário converse com o mesmo motor de Finanças (o das mensagens "50 mercado", "saldo", "reservas") pelo WhatsApp, sem inteligência artificial. O WhatsApp é só um canal: a mesma mensagem gera o mesmo rascunho e a mesma confirmação que no app.

Regra que pesa mais: **o número de telefone nunca é autoridade.** Quem manda a mensagem só é aceito se o servidor já tiver um vínculo confirmado entre aquele número e uma conta Lumen, criado de dentro da conta autenticada. Nenhum conteúdo de mensagem informa ou troca o `userId`.

## 2. O que já existe (verificado)

- O motor aceita `ConversationInput { userId, channel, messageId, text, receivedAt }` e o enum `ConversationChannel` já tem `APP` e `WHATSAPP`. Sessão é única por `(userId, channel)` e a idempotência de mensagem é `(userId, channel, messageId)` em `ConversationEvent`. Nada disso muda.
- `ConversationService.handleMessage(input)` devolve `ConversationReply` com `text`, `kind`, `draft`, `quickReplies` e `data`. O WhatsApp só precisa transformar isso em texto.
- O WA-AKG (projeto de terceiros em `codeStage/wa-akg`, versão 1.7.0, Baileys, multissessão) já está na VPS do dono em Docker. Autenticação da API por cabeçalho `X-API-Key`. Envio de texto: `POST /api/messages/{sessionId}/{jid}/send` com `{"message":{"text":"..."}}`. Webhook de mensagem recebida: evento `message.received`, com `data.key.id`, `data.from` (JID do remetente já normalizado para `@s.whatsapp.net`), `data.isGroup`, `data.key.fromMe`, `data.type`, `data.content`.
- Assinatura do webhook: cabeçalho `X-Webhook-Signature: sha256=<hex>`, que é o HMAC-SHA256 do **corpo bruto** com o segredo cadastrado no webhook. Sem segredo cadastrado, o WA-AKG não assina; por isso o Lumen recusa tudo se o segredo não estiver configurado.
- O WA-AKG dispara o webhook uma vez, com limite de 10 segundos, **sem nova tentativa** quando falha. Só aceita URL **HTTPS pública**: bloqueia HTTP e endereços privados (proteção contra SSRF). Consequência: o webhook só funciona com o backend do Lumen exposto por um domínio com HTTPS.
- O backend do Lumen não guarda o corpo bruto das requisições hoje (`main.ts` não liga `rawBody`) e não tem coluna de telefone ligada a WhatsApp (o `phone` do usuário é um campo livre de perfil, não verificado, e **não** será usado como identidade).
- Há `RateLimitGuard` no backend para limitar chamadas por rota.

## 3. O que condiciona o desenho

1. **Baileys é WhatsApp não oficial.** Há risco real de o número ser banido pelo WhatsApp, principalmente com envio em volume. O dono já registrou que o canal oficial que substituirá o WA-AKG no crescimento é uma decisão futura. Por isso o desenho envia só resposta a mensagem recebida (nunca mensagem proativa nem em massa) e limita a taxa.
2. **Sem botões.** O WhatsApp via WA-AKG aqui é texto. A confirmação é pela palavra "confirmar" e o cancelamento por "cancelar", que o motor já entende. A resposta deve dizer isso no fim do rascunho.
3. **Reentrega e duplicata.** O WA-AKG pode entregar a mesma mensagem mais de uma vez ou nenhuma. O id da mensagem do WhatsApp (`data.key.id`) é a chave de idempotência.
4. **Escrita só depois da revisão de segurança.** A spec exige revisão de segurança e os testes de isolamento A/B/C (item 6) antes de habilitar **escrita** pelo WhatsApp. Por isso o item 5 entrega o canal completo, mas com duas chaves de ambiente separadas (seção 8). Em produção a escrita fica desligada até o item 6 passar.

## 4. Fatiamento e ordem

| Fase | O que é | Quem | Saída |
|---|---|---|---|
| 5a | Backend: modelos, vínculo, webhook assinado, cliente de envio, adaptador, limites e testes | subagente haiku, revisão sonnet (obrigatória) | Backend verde e revisado, com mutantes nos filtros de escopo |
| 5b | Frontend: cartão "WhatsApp" na tela de Configurações (gerar código, ver estado, desvincular) | subagente haiku, revisão sonnet | Frontend verde e revisado |
| 5c | Integração real: backend com Postgres e Redis descartáveis, WA-AKG falso (servidor de teste que assina webhooks e recebe envios), Chrome | revisor sonnet, conferência do agente principal | Relatório com capturas |
| 5d | Runbook de ativação (webhook no WA-AKG, variáveis, número de teste) e validação manual com número real | agente principal com o dono | Só quando o dono pedir ação na VPS |

5a e 5b são independentes depois que a seção 7 (API) está fechada; o front usa mock do contrato. Um subagente por vez.

## 5. Modelo de dados (5a)

Uma migration nova, só tabelas novas.

- `WhatsappLink`: `id`, `userId` (único: uma conta tem um vínculo), `jid` (único: um número só pode ficar ativo em uma conta), `linkedAt`, `createdAt`. Relação com `User` com `onDelete: Cascade`. Desvincular **apaga** a linha (não há vínculo "inativo" para reaproveitar por engano) e apaga a sessão `WHATSAPP` pendente do usuário.
- `WhatsappLinkCode`: `id`, `userId`, `codeHash` (SHA-256 do código; o código em claro nunca é gravado), `expiresAt`, `usedAt` (nulo até o uso), `failedAttempts`, `createdAt`. Gerar um código novo invalida os anteriores do mesmo usuário.

O `jid` é guardado exatamente como o WA-AKG o entrega (`...@s.whatsapp.net`). O Lumen não converte nem completa número (evita o problema do nono dígito dos celulares brasileiros): o vínculo prova que aquele JID, como o WA-AKG o enxerga, pertence à conta.

## 6. Vínculo da conta (5a)

1. Usuário logado pede o código no app. O servidor gera um código de uso único de 8 caracteres (alfabeto sem letras ambíguas), grava só o hash, validade de 10 minutos, e devolve o código em claro **uma vez**.
2. O usuário envia esse código, como mensagem de texto, para o número do Lumen no WhatsApp.
3. O webhook recebe a mensagem. Se o remetente ainda não tem vínculo, o servidor trata o texto como candidato a código: normaliza, calcula o hash, procura um código válido, não usado e não expirado. Achando, cria o `WhatsappLink` (recusando se o `jid` já estiver vinculado a outra conta), marca o código como usado e responde que o vínculo foi feito.
4. Código inexistente, expirado ou já usado: a mesma resposta genérica, sem dizer qual dos três. O código tem tentativas limitadas por número (seção 9).
5. Desvincular: botão no app (`DELETE /whatsapp/link`) ou a frase `desvincular whatsapp` enviada do próprio número vinculado. Os dois apagam o vínculo e a sessão pendente.

Consentimento: o vínculo é iniciado pelo próprio usuário dentro da conta autenticada, e o cartão do app mostra, antes de gerar o código, que o Lumen vai receber e responder mensagens por aquele número e que o canal usa WhatsApp não oficial. A palavra de parada é a que o motor já tem: `parar` cancela o rascunho; `desvincular whatsapp` corta o canal.

## 7. API (5a)

Todas sob `/api/v1`. As rotas de conta exigem JWT; o webhook não usa JWT e se autentica só pela assinatura.

| Rota | Quem | Corpo | Resposta |
|---|---|---|---|
| `POST /whatsapp/link-code` | usuário logado | nenhum | `201 { code, expiresAt }`. 409 se a conta já tem vínculo. 503 `WHATSAPP_DISABLED` se o recurso está desligado. |
| `GET /whatsapp/status` | usuário logado | nenhum | `{ enabled, linked, linkedAt?, maskedNumber? }`. O número vem mascarado (`+55 11 *****-1234`). |
| `DELETE /whatsapp/link` | usuário logado | nenhum | `204`. Idempotente. |
| `POST /whatsapp/webhook` | WA-AKG | evento do WA-AKG | `200 {"ok":true}` quando aceito **ou** ignorado de propósito; `401` assinatura ausente ou inválida; `503` recurso desligado. Nunca devolve detalhe de usuário. |

O webhook responde sempre rápido: valida a assinatura, registra e processa; o WA-AKG tem limite de 10 segundos. O envio da resposta ao usuário é uma chamada à parte ao WA-AKG, feita depois de processar.

Regras do webhook, na ordem:

1. Recurso desligado: 503.
2. Sem segredo configurado, sem cabeçalho ou assinatura diferente (comparação em tempo constante sobre o **corpo bruto**): 401, sem processar nada.
3. Evento diferente de `message.received`, ou `sessionId` diferente do configurado, ou `fromMe`, ou grupo, ou tipo diferente de texto: `200` e ignorado. Mensagem de mídia de número vinculado recebe uma resposta curta mandando usar o app (ver seção 10).
4. Resolver o dono pelo `jid` (`WhatsappLink`). Número sem vínculo: só tenta o código de vínculo (seção 6); fora disso, uma resposta de orientação limitada a uma por número por hora, ou silêncio.
5. Número vinculado: monta `ConversationInput` com `userId` do vínculo, `channel: WHATSAPP`, `messageId = data.key.id`, `text` e `receivedAt`, chama `handleMessage`, transforma a resposta em texto e envia.
6. Mensagem repetida (mesmo `messageId`): o motor já devolve a resposta de duplicata; o adaptador não reenvia a mesma resposta duas vezes.

## 8. Configuração e chaves (5a)

Variáveis novas, só nomes aqui (valores nunca vão para Git nem para o chat):

- `WHATSAPP_ENABLED` (padrão `false`): liga vínculo, webhook e leitura.
- `WHATSAPP_WRITES_ENABLED` (padrão `false`): permite **confirmar** gravação pelo WhatsApp. Com ela desligada, o rascunho pode ser montado mas o "confirmar" pelo WhatsApp responde "Para gravar, confirme no app" e não grava. A trava fica no ponto da confirmação do motor, não só no adaptador.
- `WA_AKG_BASE_URL`, `WA_AKG_API_KEY`, `WA_AKG_SESSION_ID`, `WA_AKG_WEBHOOK_SECRET`, `WA_AKG_TIMEOUT_MS`.

`WHATSAPP_ENABLED=true` sem as outras quatro variáveis obrigatórias faz o backend recusar subir (falha cedo, sem log com valor de segredo).

## 9. Segurança

- Identidade só do vínculo (`jid` → `userId`) e só dentro do servidor. Nada no corpo do webhook, no texto, no `messageId` ou no `pushName` influencia o `userId`.
- Assinatura obrigatória, sobre corpo bruto, comparada em tempo constante. Isso exige ligar `rawBody` no Nest para essa rota (mudança em `main.ts`, medida para não afetar as outras rotas).
- Limite de taxa por número: no máximo 20 mensagens por minuto; acima disso, descarta sem responder. Tentativas de código: no máximo 5 falhas por número em 10 minutos, depois bloqueio temporário.
- O código de vínculo é aleatório de CSPRNG, de uso único, expira em 10 minutos e só existe em claro na resposta da API que o gerou.
- Um `jid` ativo em uma só conta (índice único). Tentar vincular número já vinculado a outra conta falha sem revelar de quem é.
- Logs e eventos não guardam o texto da mensagem, o saldo nem o número completo (número mascarado nos logs). `ConversationEvent` continua sem texto.
- A resposta enviada ao WhatsApp usa os mesmos textos do motor; não inclui dados de outra conta por construção (o motor já filtra por `userId`).
- Revisão obrigatória por sonnet, com mutantes que retiram: a checagem de assinatura, o filtro por `userId` na resolução do vínculo, a unicidade do `jid`, a expiração e o uso único do código, e a trava `WHATSAPP_WRITES_ENABLED`.

## 10. Adaptação das respostas (5a)

- `ConversationReply.text` vira o texto enviado. O cartão do rascunho (`draft.rows`) é impresso como linhas curtas, seguido de "Responda *confirmar* para gravar ou *cancelar* para descartar."
- `quickReplies` viram uma linha final de sugestões, só em resposta de ajuda.
- A frase `importar nota` e qualquer foto ou PDF recebidos de número vinculado respondem com um texto curto: a nota é lida na tela de Importações do app, com o endereço do app. Nesta versão o WhatsApp **não** baixa nem lê arquivo: evita guardar mídia no WA-AKG e adiar o link autenticado de revisão para depois. A spec pede "link de revisão"; ele é entregue aqui como o endereço da tela, protegido pelo login do app.
- Mensagem longa é cortada em partes de até 1000 caracteres, no máximo 3 partes.

## 11. Frontend (5b)

Cartão "WhatsApp" em Configurações, sem tela nova: estado (desligado pelo servidor, não vinculado, vinculado com número mascarado), botão "Gerar código de vínculo" que mostra o código e o prazo, instrução de enviar o código ao número do Lumen, e botão "Desvincular". Texto de consentimento visível antes de gerar o código. Funciona em claro e escuro, 360 px e desktop. O número do WhatsApp do Lumen que o usuário deve contatar vem do backend em `GET /whatsapp/status` (`contactNumber`), configurado por `WHATSAPP_CONTACT_NUMBER`.

## 12. Testes (resumo; o brief de cada subagente detalha)

- Assinatura: ausente, inválida, válida com corpo alterado em um byte, válida; segredo vazio recusa tudo.
- Vínculo: código certo, errado, expirado, reusado, de outro usuário; número já vinculado a outra conta; desvincular apaga vínculo e sessão; gerar código novo invalida o antigo.
- Identidade: payload com `userId` falso no corpo é ignorado; número sem vínculo nunca chega ao motor.
- Idempotência: mesma mensagem duas vezes grava uma vez; resposta de duplicata não é reenviada.
- Taxa: 21ª mensagem no minuto é descartada; 6ª falha de código bloqueia.
- Trava de escrita: com `WHATSAPP_WRITES_ENABLED=false`, "confirmar" pelo WhatsApp não grava; pelo app continua gravando.
- Mesma mensagem no app e no WhatsApp produz o mesmo rascunho.
- Matriz de fuso (`UTC`, `America/Sao_Paulo`, `Asia/Tokyo`) nos testes do motor que o adaptador toca.
- Integração real (5c) com WA-AKG falso: webhook assinado entra, resposta sai assinada com `X-API-Key`, duas contas A e B nunca se misturam, nenhum texto de mensagem em log.

## 13. Fora do escopo do item 5

- Ler foto ou PDF de nota pelo WhatsApp (fica para depois do redesenho da importação).
- Mensagem proativa, lembrete e envio em massa pelo WhatsApp.
- Limite por plano de WhatsApp (item de billing, fase 4 do plano).
- Troca do WA-AKG por canal oficial.
- Ação no servidor da VPS (cadastrar o webhook no WA-AKG, variáveis de produção, domínio HTTPS): só com pedido explícito do dono, na fase 5d.
- Os testes A/B/C completos e a revisão de segurança final (item 6); o item 5 entrega os testes de isolamento do que ele cria.

## 14. Decisões abertas do dono

- **D1. Número de teste.** Há um chip ou número do WhatsApp dedicado ao Lumen, conectado como sessão no WA-AKG? Sem ele, 5a a 5c se constroem e se provam com o WA-AKG falso, mas a validação real (5d) fica parada. Recomendação: separar um número só do Lumen, nunca o pessoal do dono.
- **D2. Escrita pelo WhatsApp na primeira versão.** Recomendação: código completo, `WHATSAPP_WRITES_ENABLED=false` em produção até o item 6 passar.
- **D3. Quem pode usar.** Recomendação: todos os planos durante o beta, com o limite por plano entrando na fase de billing.
- **D4. Número desconhecido que escreve para o Lumen.** Recomendação: uma resposta de orientação por hora por número (e só isso), em vez de silêncio total, para o usuário que errou o fluxo entender o que fazer.
- **D5. Nota fiscal pelo WhatsApp.** Recomendação: só orientar a usar o app nesta versão (seção 10).

## 15. Critério de pronto do item 5

- `tsc`, `jest`, `nest build`, `ng test` e `npm run build` verdes, com números reais.
- Mutantes da seção 9 mortos.
- Integração real com WA-AKG falso e duas contas.
- Capturas do cartão no Chrome, claro e escuro, 360 px e desktop.
- HANDOFF, release notes e README atualizados; merge em `develop` ao terminar; merge em `master` e tag só quando o dono pedir.
