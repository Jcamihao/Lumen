# Brief 6: testes de isolamento A/B/C e revisão de segurança antes de liberar a escrita pelo WhatsApp (subagente sonnet)

Item de segurança. Você escreve os testes, **audita o código**, prova com banco real, **corrige** o que achar e dá um veredito: libera ou não libera `WHATSAPP_WRITES_ENABLED`. (Aqui o sonnet faz o desenvolvimento e a revisão juntos, porque o próprio trabalho é revisão de segurança. Decisão do agente principal.) Relate em caveman terse (português); código, comentários, commits e documentos em prosa normal.

## Contexto

- Repositório `/home/caminhao/coding/codeStage/Lumen`, branch `feat/isolamento-whatsapp` (confira com `git branch --show-current`; outra = pare e avise). Base: `develop` com o item 5 (WhatsApp) mergeado.
- Leia primeiro: `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md` (seção "Isolamento obrigatório entre contas": regras invioláveis e testes de segurança obrigatórios; **é o seu contrato**), `docs/superpowers/specs/2026-11-18-conversa-contrato-item-5.md`, `.superpowers/sdd/whatsapp-item-5/resultado-rev-5a.md` e `resultado-5c.md` (o que já foi provado; não repita sem motivo, mas confira o que afirmam), `.superpowers/sdd/whatsapp-item-5/fake-wa-akg.mjs` (WA-AKG falso reaproveitável).
- Use `graphify query` antes de varrer arquivos.
- Chave de escopo é `userId`, só do servidor: JWT ou `WhatsappLink`.

## Parte 1: auditoria de código (leia, não presuma)

Liste em `.superpowers/sdd/isolamento-item-6/auditoria.md` **cada** consulta ao banco e cada chamada a serviço de domínio alcançável pelo motor de conversa (`backend/src/conversation/**`) e pelo WhatsApp (`backend/src/whatsapp/**`), com `arquivo:linha`, se o `where` tem `userId` (ou `id + userId`), e o veredito. Inclua: sessão, eventos, rascunho, confirmar, cancelar, `getSession` (acabou de mudar na D9: fallback para sessão WHATSAPP), consultas de leitura (saldo, metas, contas, parcelas, vencimentos), todas as gravações (transação, meta, aporte, cofrinho, limite de cartão, conta fixa, parcelas, importação de nota), categorias e cartões escolhidos por nome ou número, `WhatsappLink`/`WhatsappLinkCode`, e as rotas `/conversation/*`, `/whatsapp/*` e as de importação de nota que o motor aciona. Procure especificamente: `findUnique`/`update`/`delete` por `id` sem `userId` (o `where` único do Prisma não aceita `userId` em `update`/`delete` por id: nesses casos tem de haver checagem prévia ou `updateMany`/`deleteMany` com escopo), ids vindos de texto do usuário, `draftId` e `draftVersion` do corpo, e qualquer `userId` aceito de corpo, query, cabeçalho ou payload.

## Parte 2: testes (entram no repositório, rodam na suíte normal do jest)

Em `backend/src/conversation/` e `backend/src/whatsapp/` (specs ao lado do que testam, ou um `isolation.spec.ts` por módulo). Use o fake de Prisma que o `conversation.service.spec.ts` já usa; confira que o fake **respeita** `where` com `userId` (se não respeitar, o teste não prova nada: corrija o fake).
Contas A, B, C, cada uma com saldo, cartão, meta, categoria, conversa e vínculo de JID diferentes. Cubra, nos canais APP e WHATSAPP:
1. Ler, confirmar, cancelar e reabrir (`getSession`) por `draftId` de outra conta: falha como "não encontrado" **com a mesma resposta** de um id inexistente (não revela existência).
2. Trocar `userId` no corpo (`/conversation/message`, `/confirm`, `/cancel`), no webhook (campos extras em `data`, `userId`, `accountId`, `participant`) e no link de revisão: ignorado.
3. Mesma mensagem duas vezes e "confirmar" duas vezes (sequencial e em paralelo): grava uma vez só (`appliedKey`).
4. Alternar números: JID de A e JID de B no mesmo instante; mesmo JID em duas contas (recusado); JID de A reaproveitado depois de desvincular e vincular a B (A não herda nem B recebe sessão antiga: a sessão `WHATSAPP` é apagada ao desvincular).
5. Conversas paralelas A/B/C (`Promise.all`): estado, rascunho, resposta e dados ficam de cada um; resposta de A nunca contém saldo, categoria, meta ou nome de B/C.
6. D9: `getSession` de B nunca devolve rascunho WHATSAPP de A; com A tendo sessão APP e WHATSAPP, devolve a APP; expirada = IDLE.
7. Logs e erros: nenhuma mensagem de erro nem log contém saldo, texto de nota ou identificador de outra conta (espione `Logger`).
8. WhatsApp com `WHATSAPP_WRITES_ENABLED=false`: nenhum caminho de gravação por mensagem do WhatsApp (varie "confirmar", "sim", "ok", caixa, acento, espaços, rascunho de cada tipo: despesa, receita, meta, aporte, cofrinho, limite, conta fixa, parcela, importação) chega a serviço de domínio.

## Parte 3: mutantes de escopo (obrigatório, aplique um por vez com a ferramenta de edição, rode o teste focado, confirme que **algum teste falha**, reverta e confirme com `git diff`)

Para **cada** `where` com `userId` que a auditoria listou em código do motor e do WhatsApp, retire o `userId`. Cada mutante tem de morrer. Sobreviveu = escreva o teste que o mata. Registre a tabela completa (mutante, arquivo:linha, teste que matou).

## Parte 4: integração real (obrigatória, banco de verdade)

Postgres 16 e Redis 7 descartáveis (containers novos `lumen-w6-pg` e `lumen-w6-redis` em portas livres; **nunca** toque em `agilis-postgres`, `agilis-redis`, `habblaud` nem em outros containers; se o Docker não responder, pare e avise). Backend: `nest build`, copie `backend/dist` para uma pasta do scratchpad com `.env` **duas pastas acima** do dist (o `ConfigModule` lê `resolve(__dirname, "../../.env")`) e `node_modules` por symlink; `.env` próprio com segredos inventados, **nunca** o `.env` real da raiz. `prisma migrate deploy` (28 migrations). WA-AKG falso na porta que escolher. Escreva o roteiro como script reaproveitável `.superpowers/sdd/isolamento-item-6/isolamento-real.mjs` (sem segredo embutido; tudo por variável de ambiente; documente o uso no topo) e rode:
1. A, B e C com dados diferentes (transações, metas, cartão/limite, uma nota importada, conversas). JIDs vinculados por código, pelo webhook assinado.
2. Com `WRITES=true`: de cada conta, por **app e WhatsApp**: ler, confirmar, cancelar e reabrir por id de outra conta; `draftId`/`draftVersion` de B com token de A; `userId` falso no corpo; payloads de webhook com `userId`/`accountId` extras. Nada grava nem vaza; as respostas para id de outra conta e id inexistente são idênticas (corpo e status).
3. **Corrida do mesmo usuário (risco aberto do 5a):** 10 `confirmar` em paralelo do mesmo rascunho (WhatsApp e app, misturados) = **exatamente 1** transação; duas mensagens diferentes disparadas juntas ("50 mercado" e "sem categoria") não corrompem a sessão nem gravam sem confirmação. Registre o que acontecer, mesmo se for ruim.
4. Conversas paralelas A/B/C com dezenas de mensagens intercaladas: confira no banco que cada transação e sessão está no dono certo.
5. Reentrega do mesmo `key.id`, confirmar duas vezes, alternar JIDs entre contas via desvincular e vincular.
6. Logs do backend e do falso: `grep` por saldo, texto de mensagem, código de vínculo, chave de API, segredo e id de outra conta: zero.
7. Troca de `WRITES` (false e true) confirmando que, com false, nenhuma gravação ocorre por WhatsApp em nenhum dos tipos de rascunho.

## Correções

Qualquer falha de isolamento = ache a causa raiz, corrija com teste que a cobre e rode de novo; relate como achado de severidade alta. Mudança de contrato (rota, corpo, resposta): pare e escreva em `.superpowers/sdd/isolamento-item-6/duvidas.md`, sem inventar.

## Verificação e entrega

`npx tsc --noEmit` e `npx jest --maxWorkers=2` no `backend` (suíte inteira) e também `src/conversation src/whatsapp` com `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`. Frontend só se você mexer nele. Tudo verde antes de commitar. No máximo 2 processos pesados ao mesmo tempo; nunca `pkill -f` (mate por PID de `ss -ltnp`). Ao final derrube servidores e containers `lumen-w6-*` e apague o scratchpad que criou.

Commits pequenos, caminhos explícitos (nunca `git add -A`, nunca amend/reset; `index.lock` = esperar e repetir), prefixo convencional em português, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Não faça push. Não commite logs, `.env` nem nada do scratchpad.

Escreva `.superpowers/sdd/isolamento-item-6/resultado-6.md`: **veredito** (libera ou não `WHATSAPP_WRITES_ENABLED`, com condições), achados por severidade e o que mudou, tabela de mutantes, resultado de cada cenário real com evidência, números verdes, riscos que continuam (por exemplo Redis que cai pendura o backend, que é item separado) e o que NÃO verificou (fallback de IA do item 7 ainda não existe, então "prompt de fallback" não se aplica ainda). Responda com resumo curto.
