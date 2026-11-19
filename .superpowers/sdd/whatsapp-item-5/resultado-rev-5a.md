# Resultado da revisão do 5a (revisor sonnet)

Branch `feat/whatsapp-adapter`. Revisão de segurança do backend do adaptador de WhatsApp: leitura do diff `90a00cb..HEAD`, 15 mutantes, integração real com Postgres 16 e Redis 7 descartáveis, WA-AKG falso e backend `node dist/main` real. Sem push.

## Veredito

Aprovado depois das correções abaixo. Nenhum achado crítico. A identidade, a assinatura, o vínculo e a trava de escrita se comportaram como o contrato manda na integração real. Havia um vazamento possível da chave de API (redirecionamento), uma janela para furar o limite de 5 falhas em paralelo, um cartão de rascunho duplicado no WhatsApp e testes fracos (4 mutantes sobreviveram).

## Achados e correções

| # | Severidade | Achado | Correção (commit) |
|---|---|---|---|
| 1 | Média (segurança) | `fetch` do `WaAkgClient` segue redirecionamento por padrão. Se `WA_AKG_BASE_URL` (ou um intermediário) redirecionasse, o cabeçalho `X-API-Key` seria reenviado a outro host. | `redirect: 'manual'`: 3xx vira `WaAkgSendError('http 3xx')`. Teste com dois servidores HTTP reais (o alvo do redirecionamento não recebe nada). Na integração: o falso em modo `redirect` não viu a chave no destino. `e255e37` |
| 2 | Baixa (segurança) | O limite de 5 falhas de código lia o contador, resgatava e só depois incrementava. Tentativas em paralelo do mesmo número liam 0 e furavam o limite (teto prático: o limite de 20 por minuto). | A tentativa é contada antes do resgate com o `INCR` atômico de `hitRateLimitWindow`; acima de 5 descarta. Teste com 10 tentativas em paralelo: o resgate roda 5 vezes. Redis real: 5 respostas e a 6ª (com código válido!) muda e sem tocar no código no banco. `f1001e6` |
| 3 | Baixa (UX) | Para lançamento, meta e aporte o texto do motor já é o cartão completo e termina com `Responda "confirmar" ou "cancelar".`. O formatador acrescentava as linhas `*Rótulo:* valor` e a instrução de novo: bloco duplicado no WhatsApp (visto na integração). | Quando `kind === 'CONFIRM_DRAFT'` e o texto já traz a instrução do motor, envia só o texto. Reserva, limite, conta fixa e parcelado (texto de uma linha) continuam ganhando linhas e instrução. Teste novo. Confirmado no backend real. `77e7c2d` |
| 4 | Baixa | `WhatsappLinkCode.failedAttempts` existia sem uso (pedido do brief). | Removida do schema, da migration original e do contrato (seção 5). `prisma migrate diff` do banco limpo (as 28 migrations, 27 antigas mais a nova) contra o schema: "No difference detected". `cea14e3` |
| 5 | Baixa | `WA_AKG_TIMEOUT_MS` inválido dava `NaN` e `AbortSignal.timeout(NaN)` fazia todo envio falhar. | `parseInt(...) \|\| 8000`. `e255e37` |
| 6 | Testes | 4 mutantes sobreviveram (tabela abaixo). | Testes novos. `d4d56af` |

Itens avaliados e sem mudança:
- Identidade: `userId` só sai de `WhatsappLink` (`jid` → `userId`). Na integração, um corpo com `userId`, `accountId`, `user`, `remoteJid` de outra conta, `participant` e `pushName` hostis foi processado no dono do `data.from`; `remoteJid` divergente não muda dono nem destino. Texto encaminhado ou citado: no WA-AKG a citação vai no campo separado `quoted` (leitura de `wa-akg/src/lib/webhook.ts`, sem alterar o WA-AKG), não em `content`.
- `from` que não termina em `@s.whatsapp.net` (grupo, `@lid`, status) é descartado.
- Trava de escrita: `applyDraft` só é chamado em dois pontos (`confirmDraft` do botão e o ramo `CONFIRM_WORDS` de `handleWithSession`). Todos os outros caminhos de escrita passam por `apply*`, que só `applyDraft` chama. Integração com `WRITES=false`: "confirmar", "Confirmar!", " sim ", "OK", "CONFIRMAR" não gravam e respondem a frase de "confirme no app"; sessão e rascunho ficam; novo comando de escrita com rascunho aguardando só lembra o rascunho. O botão do app grava.
- `startsWith('/api/v1/whatsapp/webhook')` casa também `/api/v1/whatsapp/webhooks` (rota inexistente, 404, só guarda um corpo pequeno em memória). Inofensivo; não mudei.
- A política de `link-code` (5/hora) respondeu 429 na 6ª; a do webhook anuncia `X-RateLimit-Limit: 600` (casam com as rotas reais).

## Mutantes (um por vez, restaurados e conferidos com `git diff`)

| Mutante | Resultado |
|---|---|
| (a) `verifyWebhookSignature` sempre `true` | Morto: 8 testes (assinatura e controller) |
| (b) `===` de strings no lugar de `timingSafeEqual` | SOBREVIVEU. Teste novo (`spyOn(crypto, 'timingSafeEqual')`); agora morto |
| (c) controller sem checar `rawBody`/assinatura | Morto: 4 testes do controller |
| (d) `findUserIdByJid` sem o `where jid` | SOBREVIVEU (o adaptador mocka o serviço). Teste novo com duas contas; agora morto |
| (e1) sem `usedAt: null` no `findFirst` | Equivalente: o `updateMany` condicional recusa. Defesa em profundidade |
| (e2) sem `usedAt: null` no `updateMany` | SOBREVIVEU. Teste novo de leitura velha de código usado (corrida); agora morto |
| (f1) sem `expiresAt > now` no `findFirst` | Equivalente (idem e1) |
| (f2) sem `expiresAt > now` no `updateMany` | SOBREVIVEU. Teste novo de leitura velha de código expirado; agora morto |
| (g1) sem a checagem `jidTaken`/`userLinked` | SOBREVIVEU (a unicidade do banco mascarava). Teste novo exige que `create` nem seja chamado; agora morto |
| (g2) sem o tratamento de P2002 | SOBREVIVEU. Testes novos de P2002 na criação e de erro de banco que sobe; agora morto |
| (h) `createCode` sem apagar os anteriores | Morto: "codigo novo invalida o anterior" |
| (i) `unlinkByUserId` sem filtro de canal | Morto: o teste que mantém a sessão `APP` |
| (j) sem a trava `writesEnabled` | Morto: teste do motor ("WHATSAPP com escrita desligada...") |
| (k) sem supressão de `DUPLICATE` | Morto: teste de idempotência |
| (l) sem descarte de `fromMe`, de grupo e de `sessionId` (um por vez) | Mortos: 2 testes cada |
| (m) sem o limite de 20/min; sem o limite de 5 falhas | Mortos: teste da 21ª e teste da 6ª falha |
| (n) adaptador chamando o motor sem vínculo | Morto: "numero sem vinculo nunca chama o motor" |
| (o) log de envio sem `maskJid` | SOBREVIVEU. Teste novo espiando `Logger.warn` (sem jid inteiro, sem texto); agora morto |
| Correção 1 (`redirect: 'follow'`) | Morto pelo teste de redirecionamento |

## Integração real (todos PASSARAM)

Ambiente: `lumen-w5-pg` (Postgres 16, 55434), `lumen-w5-redis` (Redis 7, 56381), `prisma migrate deploy` com as 28 migrations, backend `node dist/main` na 3391 com `.env` próprio em pasta do scratchpad (segredos de teste inventados, nenhuma leitura do `.env` da raiz), WA-AKG falso na 3392 (`.superpowers/sdd/whatsapp-item-5/fake-wa-akg.mjs`, uso documentado no topo; reaproveitável na 5c). Para provar o `rawBody` por rota, a cópia do `dist` no scratchpad recebeu um middleware observador que só registra se `req.rawBody` existe.

1. Contas A e B (cadastro com consentimento). A vinculou com código em minúsculas e hífen; B vinculou normal; código usado por A e reenviado por B: resposta genérica. Só hash no banco. `GET /status` mascarado (`+55 11 *****-0001`), 409 ao pedir código já vinculado. "50 mercado" e "saldo" de cada uma: respostas só para o `jid` certo; sessões `WHATSAPP` no `userId` certo; conferido no banco.
2. `WRITES=false`: rascunho monta, "confirmar" e variações não gravam e respondem "confirme no app"; botão do app (`POST /conversation/confirm`) gravou. `WRITES=true`: "confirmar" gravou 1 transação no usuário certo, B intocado.
3. Reentrega do mesmo `key.id` (consulta e confirmação): 1 resposta, 1 evento, 1 transação.
4. Assinatura: ausente, inválida e 1 byte trocado: 401/401/401 e o falso não recebeu nada; válida: 200 `{"ok":true}`. Corpo com espaços e outra ordem de chaves, assinado nos bytes originais: 200; assinatura calculada sobre o JSON compacto e corpo enviado formatado: 401. Content-type não JSON: 401.
5. Número desconhecido: orientação uma vez, segunda muda, mídia muda. Código errado 6 vezes (a 6ª com código válido): a 6ª não responde e o código segue sem uso no banco (não chegou ao `redeem`). Redis real: `whatsapp:linkfail:<hash>` = 6, TTL 597 s.
6. 21 mensagens em um minuto: 20 respondidas, a 21ª não.
7. Mídia de vinculado: texto fixo de Importações. Texto de 1001 caracteres: pede mensagem curta. Grupo, `fromMe`, `sessionId` errado, evento diferente: 200 sem resposta. Texto vazio: orienta. `desvincular whatsapp` (com espaços e caixa): apaga o vínculo e a sessão `WHATSAPP` e preserva a `APP`; depois o número vira desconhecido; `DELETE /whatsapp/link` idempotente (204/204); re-vínculo ok.
8. Dois resgates simultâneos do mesmo código de dois números: um vínculo só. Número já vinculado a D enviando código de C: não vincula a C. Código antigo invalidado pelo novo: recusado.
9. Falso com 500, pendurado (timeout de 2 s) e com 307: webhook sempre 200 em 4 a 6 ms, backend vivo, aviso de log só com número mascarado e motivo (`http 500`, `timeout`, `http 307`), chave não chega ao destino do redirecionamento.
10. Logs (293 linhas): nenhuma ocorrência de texto de mensagem, código, chave de API, segredo do webhook, `jid` inteiro, senha, `X-API-Key` nem `key.id`. Redis só guarda hashes de `jid`. O erro do cliente carrega só `http <status>`, `timeout` ou `network` (sem URL nem corpo).
11. `POST /conversation/message` e `POST /auth/login` continuam normais com o `json()` modificado; o observador mostrou `rawBody=false` nelas e `rawBody=true` só no webhook (também com `?x=1`).
12. `WHATSAPP_ENABLED=true` sem `WA_AKG_API_KEY` e `WA_AKG_WEBHOOK_SECRET`: o backend sai com código 1 e a mensagem lista só os nomes. `WHATSAPP_ENABLED=false`: webhook 503 (assinado ou não), `link-code` 503 `WHATSAPP_DISABLED`, `status` com `enabled:false` e sem `contactNumber`.
13. Redis ausente no boot: vinculado segue respondendo; sem vínculo fica mudo (sem código nem orientação).

## Números reais

- `npx tsc --noEmit`: 0 erros.
- `npx nest build`: ok.
- `npx jest --maxWorkers=2` (suíte inteira): 59 suítes, 1525 testes, todos passando (o dev tinha 1514; +11 testes meus).
- `TZ=UTC`, `TZ=America/Sao_Paulo`, `TZ=Asia/Tokyo` com `src/conversation src/whatsapp`: 15 suítes, 585 testes, verde nas três.
- Lint: o projeto não tem configuração do ESLint (`eslint` aborta com "couldn't find a configuration file"), então não rodou.

## Riscos e o que NÃO foi verificado

- Redis que cai com o backend já no ar: o `ioredis` (`maxRetriesPerRequest: null`) enfileira o comando e a requisição do webhook (e de toda rota com `RateLimitGuard`) pendura até o Redis voltar; o desligamento do processo também travou (precisei de `kill -9`). É comportamento já existente do `CacheQueueService`, não do item 5; o 5a só trata Redis ausente desde o boot. Vale um item próprio antes de produção.
- O webhook responde 200 e processa depois (`void handleInbound`): duas mensagens do mesmo usuário em sequência rápida processam em paralelo (o motor tem controle de versão no rascunho, mas não provei a corrida entre "50 mercado" e "sem categoria" disparados juntos).
- Ordem das partes de uma resposta longa (até 3 partes) depende do WA-AKG entregar na ordem; não testei com WA-AKG real.
- Nada foi testado contra o WA-AKG real, nem com HTTPS, nem com a URL pública; o formato do webhook vem da leitura do código do WA-AKG (`src/lib/webhook.ts`) e do brief, não de captura real. O campo `type` de texto do WA-AKG real (`"text"`) não foi observado ao vivo.
- Teste A/B/C completo e revisão final de isolamento são do item 6.
- Não revisei o frontend (5b).
- Os mutantes (e1) e (f1) são equivalentes por defesa em profundidade; não os "matei".
- Decisão aberta do dono (já listada na seção 14 do contrato): endereço público do app na resposta de mídia (hoje a resposta cita a tela de Importações sem URL).

## Limpeza

Containers `lumen-w5-pg` e `lumen-w5-redis` removidos (`docker rm -f`); backend e falso encerrados por PID (um `kill -9` do backend com Redis pendurado); portas 3391, 3392, 55434 e 56381 livres; pasta do scratchpad com `.env` de teste, cópia do `dist`, logs e scripts apagada; `agilis-postgres`, `agilis-redis`, `habblaud` e `wa-akg` não tocados. O banco `shadow_w5` foi criado e removido dentro de `lumen-w5-pg`. `npx prisma generate` foi rodado (schema mudou).
