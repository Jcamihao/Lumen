# Brief 5a: backend do adaptador de WhatsApp (subagente haiku)

Você implementa o backend do canal WhatsApp do Lumen, com testes. Relate em caveman terse (português); código, comentários e commits em prosa normal.

## Antes de começar

- Repositório `/home/caminhao/coding/codeStage/Lumen`, branch `feat/whatsapp-adapter` (confira com `git branch --show-current`; outra = pare e avise).
- Leia, nesta ordem: `docs/superpowers/specs/2026-11-18-conversa-contrato-item-5.md` (**seu contrato**, aprovado pelo dono em 2026-11-18; seções 5 a 10 e 12 mandam), `backend/src/conversation/conversation.types.ts`, `backend/src/conversation/conversation.controller.ts`, `backend/src/config/asaas.config.ts`, `backend/src/billing/billing.controller.ts` (webhook público do Asaas, padrão `@Public()`), `backend/src/common/guards/rate-limit.guard.ts`, `backend/src/cache-queue/cache-queue.service.ts` (`hitRateLimitWindow`, `getJson`, `setJson`, `del`; o módulo é global), `backend/src/main.ts`.
- O WA-AKG é projeto de terceiros em `/home/caminhao/coding/codeStage/wa-akg`. **Não toque nele.** Só o contrato HTTP importa (resumido abaixo).
- Use `graphify query "<pergunta>"` antes de varrer arquivos.

## Contrato do WA-AKG (verificado na documentação e no código dele)

Webhook de entrada (WA-AKG chama o Lumen), `POST`, JSON, cabeçalho `X-Webhook-Signature: sha256=<hex>` onde hex = HMAC-SHA256(segredo, **corpo bruto**):

```json
{
  "event": "message.received",
  "sessionId": "lumen",
  "timestamp": "2026-11-18T12:00:00.000Z",
  "data": {
    "key": { "id": "3EB0ABCDEF", "remoteJid": "5511999990000@s.whatsapp.net", "fromMe": false },
    "pushName": "Nome",
    "messageTimestamp": 1763467200,
    "from": "5511999990000@s.whatsapp.net",
    "isGroup": false,
    "chatType": "PERSONAL",
    "type": "text",
    "content": "50 mercado"
  }
}
```

Use `data.from` como JID do remetente e `data.key.id` como `messageId`. `data.type` de texto é `"text"`; qualquer outro valor é mídia. Ignore (200) tudo que não for `event === 'message.received'`, que vier de outro `sessionId`, com `fromMe: true` ou `isGroup: true`.

Envio de saída (Lumen chama o WA-AKG): `POST {WA_AKG_BASE_URL}/api/messages/{sessionId}/{jid}/send`, cabeçalhos `X-API-Key: <chave>` e `Content-Type: application/json`, corpo `{"message":{"text":"..."}}`. Resposta 200: `{"status":true,"message":"...","data":{...}}`. Erros: 400, 401, 403, 404 (sessão), 500, 503 (sessão desconectada). `jid` vai codificado na URL (`encodeURIComponent`).

## O que criar

Tudo novo em `backend/src/whatsapp/` (um arquivo por responsabilidade, com `*.spec.ts` ao lado):

| Arquivo | Conteúdo |
|---|---|
| `whatsapp.config.ts` | `registerAs('whatsapp', ...)`: `enabled`, `writesEnabled` (ambos `process.env.X === 'true'`, padrão falso), `waAkgBaseUrl` (sem barra final), `waAkgApiKey`, `waAkgSessionId`, `waAkgWebhookSecret`, `waAkgTimeoutMs` (padrão 8000), `contactNumber` (`WHATSAPP_CONTACT_NUMBER`). Variáveis: `WHATSAPP_ENABLED`, `WHATSAPP_WRITES_ENABLED`, `WA_AKG_BASE_URL`, `WA_AKG_API_KEY`, `WA_AKG_SESSION_ID`, `WA_AKG_WEBHOOK_SECRET`, `WA_AKG_TIMEOUT_MS`, `WHATSAPP_CONTACT_NUMBER`. Registrar em `app.module.ts` (lista `load`) e documentar os nomes (sem valores) em `.env.example`. |
| `whatsapp.module.ts` | Importa `ConversationModule`. Declara controller e providers. Registrar o módulo em `app.module.ts`. |
| `whatsapp.controller.ts` | As 4 rotas da seção 7 do contrato (`link-code`, `status`, `DELETE link`, `webhook`). O webhook é `@Public()`, `@HttpCode(200)`, lê o corpo bruto (ver "Corpo bruto"). As outras 3 usam `@CurrentUser()` e o `userId` só vem do JWT. |
| `whatsapp-link.service.ts` | Gerar código, vincular, status, desvincular (seções 5 e 6). |
| `whatsapp-adapter.service.ts` | Processa o evento já validado: resolve o dono, trata código de vínculo, chama o motor, formata e envia (seções 7, 9, 10). |
| `wa-akg.client.ts` | Cliente de envio com `fetch` nativo, `AbortSignal.timeout(waAkgTimeoutMs)`. Nunca loga o texto enviado nem a chave. Falha de envio vira erro tratado no adaptador (não derruba o webhook). |
| `webhook-signature.ts` | Função pura `verifyWebhookSignature(rawBody: Buffer, header: string \| undefined, secret: string): boolean` com `crypto.timingSafeEqual`. Segredo vazio, cabeçalho ausente, formato diferente de `sha256=<64 hex>` ou tamanho diferente = `false` (nunca lança). |
| `whatsapp-format.ts` | Funções puras que transformam `ConversationReply` em partes de texto (seção 10). |
| `dto/` | `WhatsappStatusDto` etc. só se precisar; o corpo do webhook é validado à mão (não use `class-validator` para ele, porque o corpo é de terceiros). |

E estas alterações em arquivos existentes (só o necessário):

1. **`backend/prisma/schema.prisma`:** modelos `WhatsappLink` e `WhatsappLinkCode` da seção 5 do contrato, com relação em `User` (`whatsappLink WhatsappLink?`, `whatsappLinkCodes WhatsappLinkCode[]`), `onDelete: Cascade`, `@@unique([userId])` e `@@unique([jid])` no vínculo, `@@index([userId, createdAt])` no código. **Migration:** `backend/prisma/migrations/20261118120000_whatsapp_link/migration.sql` escrita à mão no padrão das outras (veja `20261116120000_receipt_scan_access_key`). **Não rode `prisma migrate dev` nem `migrate deploy`**; rode só `npx prisma generate`. Depois confira o SQL contra o schema com `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <url>` **só se** houver um Postgres descartável disponível; se não houver, avise na entrega que a migration não foi conferida (eu confiro).
2. **`backend/src/main.ts`:** corpo bruto só para o webhook. Troque `app.use(json({ limit: '5mb' }))` por `app.use(json({ limit: '5mb', verify: (req, _res, buf) => { if (req.url?.startsWith('/api/v1/whatsapp/webhook')) (req as any).rawBody = buf; } }))` (ajuste ao prefixo real das rotas; confira como o prefixo global é definido). As outras rotas não podem mudar de comportamento.
3. **`backend/src/common/guards/rate-limit.guard.ts`:** duas políticas novas em `policyByRoute`, no estilo das existentes: `POST /api/v1/whatsapp/webhook` (600 por 5 minutos, rota pública por IP) e `POST /api/v1/whatsapp/link-code` (5 por hora, por usuário).
4. **`backend/src/conversation/conversation.service.ts`:** a trava de escrita (seção 8 do contrato). Injete `ConfigService`. No ramo `CONFIRM_WORDS.has(words)` de `handleWithSession`, quando `awaiting && input.channel === 'WHATSAPP' && !this.configService.get<boolean>('whatsapp.writesEnabled')`, **não** chame `applyDraft`: grave o evento com `recordEvent(input, session.intent, ConversationOutcome.RECOGNIZED)`, devolva a resposta `REPLIES.whatsappWritesOff` (`'Para gravar, confirme no app: abra o assistente e toque em Confirmar. Por aqui eu monto o rascunho e respondo consultas.'`, kind `INFO`, estado atual da sessão, via `this.reply('INFO', this.stateView(session), ...)`) e deixe o rascunho e a sessão como estão. Atualize o `conversation.service.spec.ts` para fornecer o `ConfigService` (os testes existentes continuam verdes; canal `APP` nunca é afetado). O botão do app (`confirmDraft`) **não** muda.
5. **`backend/src/conversation/replies.ts`:** a constante `whatsappWritesOff` acima.

## Regras do adaptador (seções 6, 7, 9 e 10 do contrato; resumo operacional)

`WhatsappAdapterService.handleInbound(event)` (event = corpo do webhook já parseado):

1. Descarte silencioso (resolve normal, sem enviar nada): evento diferente de `message.received`; `sessionId` diferente de `waAkgSessionId`; `data.key.fromMe`; `data.isGroup`; `data.from` ausente ou que não termine em `@s.whatsapp.net`; `data.key.id` ausente.
2. Limite de taxa por número: `cacheQueueService.hitRateLimitWindow('whatsapp:rate:' + sha256(jid) , 60_000)`; mais de 20 acertos na janela = descarta sem responder. Se o Redis estiver indisponível (`null`), **falha fechada para número sem vínculo** (descarta) e aberta para número vinculado (o motor tem a idempotência).
3. Resolva o vínculo: `prisma.whatsappLink.findUnique({ where: { jid } })`. Nunca use texto, `pushName` ou qualquer campo do corpo para decidir o `userId`.
4. **Sem vínculo:** se o texto (`data.content` aparado e em maiúsculas, sem espaços e hífens internos) tem o formato do código de vínculo, tente `linkService.redeem(jid, code)`. O resultado é enviado como resposta (sucesso: `'Pronto! Este número está vinculado ao seu Lumen. Mande, por exemplo, "50 mercado" ou "saldo".'`; falha: a **mesma** frase genérica para inexistente, expirado, usado, ou número já vinculado a outra conta: `'Não consegui validar este código. Gere um novo no Lumen, em Configurações, e envie de novo.'`). Tentativas de código: no máximo 5 falhas por número em 10 minutos (`hitRateLimitWindow` com chave própria só nas **falhas**); acima disso descarte sem responder. Texto que não parece código: no máximo **uma** resposta de orientação por número por hora (`'Este número ainda não está vinculado a uma conta do Lumen. Abra o Lumen, vá em Configurações > WhatsApp e gere um código de vínculo.'`), controlada por uma chave `whatsapp:hint:<sha256(jid)>` com TTL de 3600 s; fora disso, silêncio. Se o Redis estiver indisponível, silêncio.
5. **Com vínculo:** `userId` = o do vínculo.
   - Mídia (`data.type !== 'text'`): resposta fixa curta mandando usar a tela de Importações do app (sem baixar nada), sem chamar o motor.
   - Texto igual (normalizado) a `desvincular whatsapp`: `linkService.unlinkByUserId(userId)` e confirma por mensagem.
   - Caso contrário: `conversationService.handleMessage({ userId, channel: 'WHATSAPP', messageId: data.key.id, text: data.content, receivedAt: new Date() })` e envie o texto formatado. Texto vazio ou com mais de 1000 caracteres: não chame o motor; responda pedindo mensagem mais curta (nenhum dado vai ao motor).
6. Falha ao enviar (WA-AKG fora do ar, 5xx, timeout): registre `warn` **sem texto de mensagem e sem número completo** (use número mascarado, ver abaixo) e siga. O webhook ainda responde 200 (não adianta o WA-AKG reentregar: o motor já gravou o evento e a duplicata daria resposta repetida).
7. Reentrega (mesmo `messageId` já processado): o motor responde com resposta de duplicata (`ConversationOutcome.DUPLICATE`). O adaptador **não envia** resposta quando o `kind` da resposta do motor for `DUPLICATE`.

Número mascarado: função pura `maskJid(jid)` → `+55 11 *****-0000` (mantém código do país, 2 dígitos de DDD e os 4 últimos; se o formato for estranho, `'***'`). Usada em logs e em `GET /status`. Nunca logar o `jid` inteiro, o texto recebido, o código nem a chave de API.

## Vínculo (`WhatsappLinkService`)

- `createCode(userId)`: 409 `WHATSAPP_ALREADY_LINKED` se o usuário já tem vínculo; `503 WHATSAPP_DISABLED` se `enabled` for falso. Gera 8 caracteres do alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` com `crypto.randomInt`, grava `sha256(código)`, `expiresAt` = agora + 10 min, **invalida** os códigos anteriores do usuário (marque `usedAt = now` ou apague; escolha apagar os não usados) e devolve `{ code, expiresAt }`. O código em claro nunca é gravado nem logado.
- `redeem(jid, rawCode)`: normalize (maiúsculas, tire espaços e hífens); procure por `codeHash` com `usedAt: null` e `expiresAt > agora`; primeiro marque `usedAt` **fora** da transação de criação, de forma condicional (`updateMany where usedAt null e expiresAt > agora` e confira `count === 1`, para dois resgates simultâneos não passarem e para o consumo valer mesmo se a criação falhar); só então crie o `WhatsappLink` (a violação do índice único de `jid` ou de `userId` é a falha esperada, tratada como `false`). Se o `jid` já está vinculado a qualquer conta, ou o usuário do código já tem vínculo, não cria nada, mas o código **fica consumido** (`usedAt` marcado): assim a tentativa não serve de oráculo para descobrir se um número já tem conta. Retorna `true`/`false`, nunca o motivo.
- `getStatus(userId)`: `{ enabled, linked, linkedAt?, maskedNumber?, contactNumber? }`. `contactNumber` só quando `enabled`.
- `unlinkByUserId(userId)`: apaga o vínculo e a sessão `ConversationSession` do canal `WHATSAPP` desse usuário, na mesma transação. Idempotente (sem vínculo = sucesso). Eventos `ConversationEvent` ficam (são auditoria sem texto).
- Boot: se `enabled` for `true` e faltar `waAkgBaseUrl`, `waAkgApiKey`, `waAkgSessionId` ou `waAkgWebhookSecret`, `onModuleInit` lança erro com a lista dos **nomes** que faltam (nunca valores).

## Formatação (`whatsapp-format.ts`, seção 10)

- Base: `reply.text`. Se `reply.draft` existir, acrescente cada `draft.rows` como `*Rótulo:* valor` em linhas separadas, e feche com a linha fixa `Responda *confirmar* para gravar ou *cancelar* para descartar.` **somente** se `reply.kind === 'CONFIRM_DRAFT'`.
- `reply.quickReplies` só entram quando `reply.kind === 'HELP'`, numa linha final `Exemplos: a | b | c`.
- Corte em partes de até 1000 caracteres, quebrando de preferência em `\n`; no máximo 3 partes (o excedente é descartado com `…` no fim da última). Teste: texto de 2500 caracteres, de 4000, sem quebra de linha.
- Nunca inclua `draftId`, `draftVersion` nem ids internos.

## Armadilhas conhecidas

1. Projeto compila para CommonJS **sem** `esModuleInterop`: `import crypto = require('crypto')` ou `import { createHash } from 'crypto'` (este segundo já funciona com `@types/node`).
2. `strictNullChecks` está desligado, mas trate `null` explicitamente.
3. Dinheiro e datas: o adaptador não mexe com isso; o motor cuida. Mas qualquer teste que dependa de fuso deve rodar nas três zonas.
4. Nada de `setTimeout` solto sem limpar em `finally`.
5. `ConversationService` hoje não recebe `ConfigService`; ao injetar, atualize **todos** os pontos que o constroem (spec e módulo) e rode a suíte do motor inteira.
6. O guard JWT é global: rota sem `@Public()` exige token. O webhook precisa de `@Public()`, mas **nunca** deve processar nada sem assinatura válida.
7. `RateLimitGuard` roda antes do controller; a política da rota é pela string `METHOD /caminho` exata, com o prefixo `/api/v1`.

## Regras do projeto

- Nada de `sed -i`, `perl -i`, `python` ou edição de arquivo por shell: use as ferramentas de edição. Nada de `sleep`. Máximo de 2 processos pesados (jest/tsc) ao mesmo tempo; `npx jest --maxWorkers=2`. Rodar muitos em paralelo derruba a máquina.
- Comentário só onde o motivo não é óbvio, em português.
- Commits com caminhos explícitos (nunca `git add -A`), mensagem em prosa normal no padrão `feat(whatsapp): ...`, terminando com `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Nunca amend nem reset. Não faça push. `index.lock` = espere e repita.
- Dúvida ou mudança de contrato: registre em `.superpowers/sdd/whatsapp-item-5/duvidas.md` e siga com a leitura mais segura. Não decida sozinho o que a seção 14 do contrato deixa para o dono.

## Testes obrigatórios (cada linha é um teste que precisa falhar se a regra for removida)

`webhook-signature.spec.ts`:
- assinatura válida passa; corpo alterado em 1 byte falha; cabeçalho ausente, sem prefixo `sha256=`, com hex curto, com hex inválido, ou segredo vazio: `false` e nunca lança; maiúsculas no hex da assinatura: defina e teste um comportamento (recomendado: aceitar só minúsculas).

`whatsapp-link.service.spec.ts` (Prisma simulado ou o padrão de teste que o projeto já usa; veja `conversation.service.spec.ts`):
- código certo vincula e marca usado; errado, expirado, já usado e de outro formato: `false`; usado duas vezes em paralelo (`Promise.all`): só um vincula; `jid` já vinculado a outra conta: `false`, nenhum vínculo novo e o código fica consumido; usuário já vinculado pede código: 409; `createCode` com `enabled` falso: 503; código novo invalida o anterior; só o hash vai ao banco (o código em claro não aparece em nenhuma chamada do Prisma simulado); `unlinkByUserId` apaga vínculo e sessão `WHATSAPP` e **não** apaga a sessão `APP`; é idempotente; `getStatus` devolve número mascarado, nunca o `jid` inteiro; boot com `enabled` e variável faltando lança com os nomes.

`whatsapp-adapter.service.spec.ts` (motor e cliente simulados):
- identidade: payload com `userId`, `accountId` ou `user` falsos no corpo e em `data` é ignorado, e o motor recebe o `userId` do vínculo; número sem vínculo nunca chama o motor.
- descartes silenciosos: evento errado, `sessionId` errado, `fromMe`, grupo, `from` sem `@s.whatsapp.net`, sem `key.id`: nada enviado, nada chamado.
- idempotência: duas entregas com o mesmo `messageId` chamam o motor duas vezes, mas só a primeira resposta é enviada (a segunda vem com `kind: 'DUPLICATE'`).
- taxa: 21ª mensagem no minuto descartada; 6ª falha de código em 10 minutos descartada; Redis indisponível: número sem vínculo descartado, vinculado segue.
- orientação a número desconhecido: no máximo uma por hora por número.
- mídia de número vinculado: resposta fixa, motor não chamado. `desvincular whatsapp`: desvincula e confirma. Texto vazio e texto de 1001 caracteres: motor não chamado.
- falha do cliente de envio (rejeita): o adaptador não lança.
- o motor recebe `channel: 'WHATSAPP'`, `messageId` igual a `key.id`, `text` igual a `content`.

`wa-akg.client.spec.ts` (`fetch` simulado):
- URL e cabeçalhos exatos (`X-API-Key`, `Content-Type`), `jid` codificado, corpo `{"message":{"text":...}}`; erro HTTP e timeout viram erro tratável; a chave e o texto não aparecem em nenhum log (espie o `Logger`).

`whatsapp.controller.spec.ts`:
- webhook: sem assinatura 401; assinatura inválida 401; segredo não configurado 401 (nunca processa); desligado 503; assinatura válida chama o adaptador e devolve `200 {"ok":true}`; o adaptador **não** é chamado nos casos 401/503. Teste com corpo bruto real (Buffer) e a assinatura calculada no teste.
- rotas de conta: `link-code`, `status` e `DELETE link` usam o `sub` do usuário autenticado; não há parâmetro nem corpo que mude o dono.

`whatsapp-format.spec.ts`: o que a seção "Formatação" lista, mais: `CONFIRM_DRAFT` ganha a linha de confirmar e `INFO` não; sem `draftId` no texto.

`conversation.service.spec.ts` (acrescente, não troque):
- `WHATSAPP` + `writesEnabled` falso + `AWAITING_CONFIRMATION` + "confirmar": **nada é gravado** (espie o serviço de transações), rascunho e sessão intactos, resposta é a de `whatsappWritesOff`, evento `RECOGNIZED`.
- mesmo cenário com `writesEnabled` verdadeiro: grava normalmente.
- mesmo cenário no canal `APP` com `writesEnabled` falso: grava normalmente (a trava é só do WhatsApp).
- `confirmDraft` (botão do app) não é afetado.

`rate-limit.guard.spec.ts` (se existir; senão ao lado do guard): as duas políticas novas existem com os limites certos.

## Entrega

Quando terminar: `npx tsc --noEmit` (0 erros), `npx nest build`, `npx jest --maxWorkers=2` na suíte inteira (cole os números reais), mais `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo` em `npx jest src/conversation src/whatsapp --maxWorkers=2`, um de cada vez. Escreva `.superpowers/sdd/whatsapp-item-5/resultado-5a.md` com: arquivos, números de teste, dúvidas e o que **não** conseguiu verificar (migration sem banco, por exemplo). Commits pequenos e separados por assunto (schema e migration; config e vínculo; webhook e adaptador; trava de escrita no motor).
