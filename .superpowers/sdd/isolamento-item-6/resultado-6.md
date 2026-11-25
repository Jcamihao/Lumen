# Resultado do item 6: isolamento A/B/C e revisão de segurança antes da escrita pelo WhatsApp

Branch `feat/isolamento-whatsapp` (base `develop` com o item 5). Executor: sonnet (desenvolvimento e revisão juntos, como o brief manda). Sem push.

## Veredito

**Libera `WHATSAPP_WRITES_ENABLED=true` quanto ao isolamento entre contas, com as condições abaixo.** Não achei nenhuma falha de isolamento (nenhum achado de severidade alta ou média). Li cada consulta do motor e do WhatsApp (`auditoria.md`), os 30 mutantes de escopo morreram, e o roteiro com Postgres 16 e Redis 7 reais passou inteiro (96 verificações com escrita ligada, 34 com escrita desligada, zero falhas).

Condições antes de ligar em produção (nenhuma é falha de isolamento; são riscos que o dono precisa aceitar ou tratar):

1. **WA-AKG real nunca foi testado** (nem os testes do 5, nem estes). O formato do webhook vem da leitura do código do WA-AKG. Ligar a escrita só depois de uma conversa ponta a ponta com o WA-AKG real, em conta de teste, e com `WHATSAPP_WRITES_ENABLED=false` primeiro.
2. **Redis que cai com o backend no ar pendura o webhook** (risco do 5a, continua; item separado). Resolver antes de produção.
3. **Mensagens do mesmo número processam em paralelo** (achado 1 abaixo): ordem não garantida. Não grava nada errado, mas "confirmar" colado no rascunho pode chegar antes dele. Recomendo serializar por número antes de divulgar o canal.
4. **Decisão do dono (D9)**: com a escrita do WhatsApp desligada, o botão Confirmar do app grava o rascunho que veio do WhatsApp. É o desenho atual (confirmado nos testes), mas muda o sentido de "trava": a trava bloqueia só a confirmação por mensagem. Confirmar que é isso mesmo que ele quer.
5. Fallback de IA (item 7) ainda não existe: o teste "prompt de fallback isolado" não se aplica e tem de ser refeito quando o item 7 existir (a spec exige que o fallback não chame ferramenta de escrita).

## Achados

| # | Severidade | Achado | O que mudou |
|---|---|---|---|
| 1 | Baixa (funcional, não é vazamento) | O webhook responde 200 e processa com `void handleInbound`, sem fila por número. Duas mensagens do mesmo usuário em sequência rápida processam em paralelo. Visto no roteiro real: A mandou "11,11 mercado" e "confirmar" sem esperar a resposta; o "confirmar" correu antes do rascunho existir, respondeu "Não entendi" e a gravação não aconteceu (4 pedidos, 3 gravados). Não grava a mais nem a menos sem confirmação: nas 12 rodadas de mensagens concorrentes diferentes (ver cenário 3) nenhuma gravou sem confirmação e a sessão nunca corrompeu. | Nada no código (não é isolamento). Recomendação: fila por `jid` no adaptador (cadeia de promises em memória, ou trava no Redis se houver mais de um processo). |
| 2 | Baixa (UX) | Reentrega simultânea do mesmo `key.id` (3 entregas ao mesmo tempo) de uma leitura gerou 3 respostas e 1 evento. A checagem de duplicata lê o evento antes de gravá-lo. A confirmação não duplica (reivindicação por `deleteMany` com `version` e `appliedKey`). O WA-AKG não reentrega em paralelo. | Nada. Registrado no teste (`whatsapp/isolation.spec.ts`, "mesmo key.id em paralelo"). |
| 3 | Informativo | Retirar o `userId` de `findUnique({ where: { userId } })` é erro de tipo no Prisma real, então o compilador já protege 5 dos 30 pontos; por isso testei esses mutantes com `where: {} as never` (o caso que o compilador não pega). | Nada. |
| 4 | Informativo | `request_completed` e `request_failed` do backend registram o `userId` de quem fez a chamada (o próprio), rota e status. Nenhuma linha mistura ids de duas contas, e nenhum id de rascunho ou nota alheio apareceu em log. | Nada. |

Nada do que o brief mandava corrigir apareceu. Não alterei código de produção. O único arquivo não-teste mexido é `backend/tsconfig.build.json` (exclui `*.fixture.ts` do build).

## O que entrou no repositório

- `backend/src/conversation/isolation.fixture.ts`: banco em memória que **respeita todo `where`** (igualdade, `in`, `gt/gte/lt/lte`, `null`; operador desconhecido lança erro, então um filtro nunca é ignorado em silêncio). Os serviços de domínio são fakes que só leem as linhas do `userId` recebido. O fake que o `conversation.service.spec.ts` já usava não filtrava `transaction.groupBy`, então não servia para provar escopo; não o alterei (os testes antigos seguem como estão) e criei este.
- `backend/src/conversation/isolation.spec.ts` (58 testes) e `backend/src/whatsapp/isolation.spec.ts` (35 testes).
- `.superpowers/sdd/isolamento-item-6/auditoria.md` (Parte 1), `isolamento-real.mjs` (Parte 4, reaproveitável, uso no topo, sem segredo) e este resultado.

Cobertura pedida no brief (item do brief -> onde):
1. ler, confirmar, cancelar e reabrir por `draftId` de outra conta, nos canais APP e WHATSAPP, mesma resposta que id inexistente (serviço e controller) -> `isolation.spec.ts` (conversation), bloco 1.
2. `userId` no corpo, webhook com `userId`/`accountId`/`participant`/`remoteJid` extras, webhook assinado e não assinado -> bloco 2 (conversation) e blocos "2." e "webhook assinado" (whatsapp). Link de revisão: **não existe no código** (grep em `conversation` e `whatsapp`), então não se aplica.
3. mesma mensagem duas vezes, confirmar duas vezes, sequencial e em paralelo (10 em paralelo) -> bloco 3 nos dois arquivos.
4. alternar números, mesmo JID em duas contas, JID reaproveitado depois de desvincular -> bloco 4 (whatsapp).
5. conversas paralelas A/B/C com `Promise.all`, 4 rodadas de 14 mensagens por conta -> bloco 5 (conversation).
6. D9 `getSession` -> bloco 6 (conversation), incluindo expirada e rascunho forjado.
7. logs e erros: espionei `Logger` (log, warn, error, debug, verbose, fatal) -> bloco 7 nos dois arquivos.
8. trava de escrita: 9 tipos de rascunho x 15 variações de "confirmar" (caixa, acento, espaços, ponto, exclamação, tab) -> bloco 8 nos dois arquivos, mais o controle com a trava ligada.

## Mutantes de escopo (Parte 3)

Cada `where` com `userId` do motor e do vínculo do WhatsApp teve o `userId` retirado, um por vez, rodando `src/conversation/isolation.spec.ts` e `src/whatsapp/isolation.spec.ts`; restaurei o arquivo e conferi `git diff` limpo depois de cada rodada (e no fim). **Desvio do brief:** apliquei e reverti por script (substituição na linha exata, `cp` de volta do original, `git status` no fim) e não pela ferramenta de edição, para caber na rodada; a garantia é a mesma (um por vez, restaurado, diff conferido). Os 4 últimos (X01 a X04) são extras que não estavam no brief (trava de escrita e `getSession`).

Resultado: 34 de 34 mortos, nenhum sobrevivente no fim. Um sobreviveu na primeira rodada (M02, duplicata sem `channel`) e escrevi o teste que o mata. M22, M24, M25, M26 e M30 deram erro de compilação (o Prisma recusa `where` sem chave única) e foram refeitos com `where: {} as never` para morrerem por teste.

| Mutante | Arquivo:linha | Mutação | Resultado | Teste que matou (o primeiro) |
|---|---|---|---|---|
| M01 | conversation.service.ts:274 | duplicata: findFirst sem userId | MORTO (1 testes) | o mesmo messageId em contas diferentes nao colide: as d |
| M02 | conversation.service.ts:274 | duplicata: findFirst sem channel | MORTO (1 testes) | o mesmo messageId em canais diferentes da mesma conta nao colide: os dois processam |
| M03 | conversation.service.ts:294 | confirmDraft: findFirst sem userId | MORTO (8 testes) | o botao do app confirma o rascunho do proprio dono e so dele (D9), sem |
| M04 | conversation.service.ts:308 | cancelDraft: findFirst sem userId | MORTO (5 testes) | cancelar com draftId de B, |
| M05 | conversation.service.ts:743 | nome de reserva repetido sem userId | MORTO (1 testes) | nome de reserva de B nao conta como "nome repetido" para A |
| M06 | conversation.service.ts:871 | fillPendingField: updateMany sem userId | MORTO (1 testes) | fillPendingField com userId d |
| M07 | conversation.service.ts:1179 | applyDraft: claim deleteMany sem userId | MORTO (1 testes) | applyDraft com userId de B so |
| M08 | conversation.service.ts:1205 | evento (escrita incerta) sem userId | MORTO (1 testes) | atualizacao do evento da conf |
| M09 | conversation.service.ts:1213 | evento (revisao) sem userId | MORTO (1 testes) | atualizacao do evento da conf |
| M10 | conversation.service.ts:1220 | evento (falha ao gravar) sem userId | MORTO (1 testes) | atualizacao do evento da conf |
| M11 | conversation.service.ts:1239 | evento (sucesso) sem userId | MORTO (1 testes) | atualizacao do evento da conf |
| M12 | conversation.service.ts:1527 | cancelSession sem userId | MORTO (1 testes) | cancelSession e expireSession |
| M13 | conversation.service.ts:1539 | expireSession sem userId | MORTO (1 testes) | cancelSession e expireSession |
| M14 | conversation.service.ts:1634 | gasto por categoria: groupBy sem userId | MORTO (1 testes) | gasto por categoria: a transacao de B apontando para a categoria de A nao entra |
| M15 | conversation.service.ts:1637 | gasto por categoria: categorias sem userId | MORTO (1 testes) | gasto por categoria: categoria homonima de B nao se mistura com a de A |
| M16 | conversation.service.ts:1826 | resolveCategory sem userId | MORTO (2 testes) | receita: "confirmar", "sim", "ok" e variacoes nao gravam, e a resposta |
| M17 | conversation.service.ts:1851 | pickCategoryAnswer sem userId | MORTO (1 testes) | A responde com o nome da categoria de B a pergunta de categoria: cai em "sem ca |
| M18 | conversation.service.ts:2112 | cartao: categoria do rascunho sem userId | MORTO (1 testes) | rascunho forjado com categoria de B: o cartao mostra "sem categoria", |
| M19 | conversation.service.ts:2188 | categoryNames sem userId | MORTO (1 testes) | opcoes forjadas com categoria e meta de B: a pergunta nao mostra o no |
| M20 | conversation.service.ts:2197 | loadSession sem userId | MORTO (11 testes) | desvincular A nao toca no vinculo, na sessao WHATSAPP nem no codigo de B; p |
| M21 | conversation.service.ts:2197 | loadSession sem channel | MORTO (4 testes) | desvincular A nao toca no vinculo, na sessao WHATSAPP nem no codigo de B; p |
| M22 | whatsapp-link.service.ts:67 | createCode: vinculo existente sem userId | MORTO (32 testes) | A, B e C vinculam seus numeros... |
| M23 | whatsapp-link.service.ts:76 | createCode: apaga codigos de todos | MORTO (2 testes) | mesmo JID em duas contas: o segundo resgate e recusado e o dono continua o |
| M24 | whatsapp-link.service.ts:112 | redeem: jid ja usado sem filtro jid | MORTO (7 testes) | A, B e C vinculam seus numeros... |
| M25 | whatsapp-link.service.ts:113 | redeem: conta ja vinculada sem userId | MORTO (7 testes) | A, B e C vinculam seus numeros... |
| M26 | whatsapp-link.service.ts:132 | getStatus sem userId | MORTO (2 testes) | mesmo JID em duas contas... |
| M27 | whatsapp-link.service.ts:144 | unlink: apaga vinculo de todos | MORTO (1 testes) | desvincular A nao toca no vinculo, na sessao WHATSAPP nem no codigo de B; p |
| M28 | whatsapp-link.service.ts:145 | unlink: apaga sessao WHATSAPP de todos | MORTO (1 testes) | desvincular A nao toca no vinculo, na sessao WHATSAPP nem no codigo de B; p |
| M29 | whatsapp-link.service.ts:145 | unlink: apaga tambem a sessao APP | MORTO (2 testes) | desvincular A nao toca no vinculo, na sessao WHATSAPP nem no codigo de B; p |
| M30 | whatsapp-link.service.ts:151 | findUserIdByJid sem filtro jid | MORTO (6 testes) | A, B e C vinculam seus numeros... |
| X01 | conversation.service.ts:800 | trava de escrita do WhatsApp removida | MORTO (19 testes) | WRITES=false pelo webhook: despesa... |
| X02 | conversation.service.ts:800 | trava de escrita aplicada ao canal errado | MORTO (19 testes) | WRITES=false pelo webhook: despesa... |
| X03 | conversation.service.ts:330 | getSession devolve sessao WHATSAPP em coleta | MORTO (1 testes) | rascunho WHATSAPP ainda em coleta nao aparece no app |
| X04 | conversation.service.ts:326 | getSession usa sessao APP expirada | MORTO (1 testes) | expirada = IDLE... |

Equivalentes que não "morrem" sem forçar o cenário: as atualizações por `id` de uma linha criada no mesmo pedido (M06 a M13) só mudam de comportamento se o id colidir com o de outra conta. Matei esses chamando o método privado com a sessão de A e o `userId` de B (M06, M07, M12, M13) e simulando a colisão de id no fake (M08 a M11). Não há equivalente que eu tenha deixado de lado.

## Roteiro real (Parte 4)

Ambiente: `lumen-w6-pg` (Postgres 16, porta 55461) e `lumen-w6-redis` (Redis 7, 56461), `prisma migrate deploy` com as 28 migrations; backend `node dist/main.js` (cópia do `nest build` fora do repositório, `.env` duas pastas acima com segredos inventados; o `.env` da raiz nunca foi lido) na 3661; WA-AKG falso (`.superpowers/sdd/whatsapp-item-5/fake-wa-akg.mjs`) na 3662. Roteiro: `.superpowers/sdd/isolamento-item-6/isolamento-real.mjs`. Duas rodadas com banco e backend zerados: `writes-true` (96 PASS, 0 FAIL) e `writes-false` (34 PASS, 0 FAIL). As contas foram criadas pela API real; o JID de cada uma foi vinculado por código, pelo webhook assinado.

1. **A, B e C com dados diferentes**: categorias, receita e despesa, meta, limite de cartão e uma nota importada cada (o `ReceiptScan` entrou direto no banco, a leitura por QR/OCR não é o assunto; a confirmação usou `POST /imports/receipts/commit` real). Vínculos conferidos no banco; só hash de código no banco; "importar nota" só orienta e não cita dado alheio. PASS.
2. **Ataques com `WRITES=true`**, nos dois canais: confirmar e cancelar com `draftId` de B usando o token de A responderam 404 com o mesmo corpo que id inexistente (comparado campo a campo; só `requestId` e `timestamp` mudam por requisição, e retirá-los foi necessário: a primeira versão do roteiro comparava o texto cru e deu falso FAIL). Confirmar com a versão errada: 404. `GET /conversation/session` de A e de C: sem rascunho de B. `userId` no corpo de `/message`, `/confirm` e `/cancel`: **400** (o `ValidationPipe` global usa `forbidNonWhitelisted`; recusado, não só ignorado). Cabeçalhos `X-User-Id`/`X-Account-Id` de B: ignorados. Webhook com `userId`, `accountId`, `user`, `participant` e `remoteJid` de B vindo do número de A: processado como A, resposta só para A, evento gravado na conta de A. Nada gravado em nenhuma conta durante os ataques; B confirmou o próprio rascunho (controle positivo) e só B ganhou transação. Importar a nota de B com o token de A: 404 igual ao de nota inexistente. PASS.
3. **Corrida do mesmo usuário (risco aberto do 5a)**: 3 rodadas com 10 confirmações em paralelo (5 `POST /conversation/confirm` + 5 mensagens "confirmar"/"sim" do WhatsApp): **exatamente 1 transação** e 1 evento com `appliedKey` em cada rodada; o app respondeu `200,200,404,404,404`, `200,200,200,200,200` e `200,200,200,200,200` (200 = resposta de duplicata ou de gravação; 404 = rascunho já consumido). Duas mensagens diferentes juntas ("50 mercado" e "sem categoria", depois "sem categoria", "50 mercado" e "1" com categoria pendente): 12 rodadas, nenhuma gravação sem confirmação, sessão sempre válida (estado, JSON do rascunho, no máximo uma por conta e canal; estados finais observados: 24 vezes `AWAITING_CONFIRMATION`). O lado ruim está no achado 1 (ordem entre mensagens) e no achado 2.
4. **Conversas paralelas A/B/C**: 4 rodadas por conta, intercaladas (app e WhatsApp), com leitura de saldo, metas, contas fixas e limite, rascunho e confirmação. Cada conta gravou exatamente o que pediu; nenhuma transação de valor "da conta X" existe em outra conta; a categoria de cada transação é do mesmo dono; toda sessão e todo evento pertence a A, B ou C; nenhuma resposta (app e WhatsApp) citou saldo, categoria, meta, id ou número de outra conta. PASS.
5. **Reentrega, confirmar duas vezes, alternar JIDs**: mesmo `key.id` reentregue: 1 resposta e 1 evento; confirmar em paralelo com o mesmo `key.id` e outra mensagem: 1 transação. `DELETE /whatsapp/link` idempotente (204 e 204); desvincular A apagou a sessão `WHATSAPP` de A e preservou o vínculo de B. O número antigo de A, vinculado a B: responde o saldo de B, nunca o de A; B não herdou sessão e nada foi gravado. Conta já vinculada pede código: 409. O JID de A existe em uma conta só. A vinculou um número novo e vê só o próprio saldo. Assinatura inválida e ausente: 401 e sem resposta. PASS.
6. **Logs**: backend (606 linhas na rodada true, 333 na false) e falso: zero ocorrências de saldo (formatado e cru, inclusive os saldos finais), categorias, metas, números, texto de mensagem ("sem categoria", valores usados), códigos de vínculo, chave de API, segredo do webhook, segredos do JWT e do MFA, senha de teste e ids de rascunho e de nota de outra conta. Nenhuma linha mistura ids de duas contas. Linhas com `userId=` próprio existem (log operacional do chamador). PASS.
7. **Troca de `WRITES`**: com `false`, para cada um dos 9 tipos (despesa, receita, meta, cofrinho, aporte, reserva, limite do cartão, conta fixa, parcela) o rascunho montou e 11 variações de "confirmar" não gravaram nada (transações, metas e aporte, reservas, contas fixas, parcelados e tetos do cartão, medidos no banco) e o rascunho continuou aguardando; as respostas mandam confirmar no app; o botão do app gravou o rascunho do WhatsApp (D9) e outra conta não consegue confirmar o mesmo id. Com `true`, o primeiro "confirmar" gravou nos 9 tipos. PASS.

Controle do que o roteiro mede: o grep dos logs procurou também uma lista de segredos construída a partir do que o próprio roteiro criou (códigos, saldos, ids), e as linhas de log com `userId` aparecem listadas como nota, então o "zero" não é de uma busca vazia.

## Números verdes

- `npx tsc --noEmit` (backend): 0 erros. `npx nest build`: ok.
- `npx jest --maxWorkers=2` (suíte inteira): **61 suítes, 1624 testes, todos passando** (o 5c registrou 59 suítes e 1526 testes; esta branch acrescenta 2 suítes e 93 testes novos, 58 no motor e 35 no WhatsApp).
- `TZ=UTC`, `TZ=America/Sao_Paulo`, `TZ=Asia/Tokyo` com `src/conversation src/whatsapp`: 17 suítes, 684 testes, verde nas três.
- Lint: o projeto não tem configuração do ESLint (já era assim no 5a), então não rodou. Frontend: não mexi.

## Riscos que continuam e o que NÃO verifiquei

- Redis que cai com o backend no ar (pendura o webhook e o desligamento): item separado, não testado aqui.
- WA-AKG real, HTTPS público, domínio e webhook cadastrado: não testado. Ordem das partes de uma resposta longa também depende do WA-AKG real.
- Fallback de IA (item 7) não existe; "prompt de fallback" não se aplica. Refazer a revisão quando existir, com a regra "fallback não chama ferramenta de escrita".
- Link de revisão: não existe no código; o teste de "trocar `userId` no link de revisão" não se aplica.
- Os testes unitários usam serviços de domínio fake (só provam que o motor chama com o `userId` certo e que o `where` do motor e do vínculo leva o escopo). O escopo dos serviços de domínio reais foi **lido** (`auditoria.md`) e **exercido** pelo roteiro real, mas sem mutantes neles (fora do escopo do brief, que pedia o motor e o WhatsApp).
- O roteiro real usa um mesmo processo de backend; execução com mais de um processo (corrida entre réplicas) não foi testada.
- O limite de 20 mensagens por minuto por número e o limite de 600 por minuto do webhook foram contornados limpando as chaves do Redis entre etapas do roteiro; não os testei de novo (o 5a já testou).
- Multi-dispositivo e mensagens de grupo: descartadas pelo adaptador (já testado no 5a); não repeti.

## Limpeza

Containers `lumen-w6-pg` e `lumen-w6-redis` removidos; backend e falso encerrados por PID; portas 3661, 3662, 55461 e 56461 livres; `agilis-postgres`, `agilis-redis` e `habblaud` não tocados; pastas do scratchpad (cópia do `dist`, `.env` de teste, logs, scripts de mutante) apagadas. `graphify update .` rodado (só AST).
