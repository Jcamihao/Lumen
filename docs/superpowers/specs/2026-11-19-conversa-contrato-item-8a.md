# Contrato do item 8a: editar e apagar lançamento por conversa

Data: 2026-11-19. Base: roteiro `2026-11-14-assistente-manual-financas.md` (item 8). Decisões do dono em 2026-11-19: (1) o item 8 vai em fatias, a 8a é só **lançamento** (8b metas/reservas, 8c recorrência/conta fixa/parcelado, 8d limite do cartão); (2) o item é escolhido por **lista numerada**; (3) apagar exige **confirmação reforçada**.

## 1. Regras gerais
- Só mexe no que o bot mostrou antes: busca -> lista numerada (até 5) -> escolha do número -> prévia exata -> confirmação. Nunca "apaga tudo", nunca edição por suposição.
- Usa os mesmos serviços da tela (`TransactionsService.update` e `remove`): mesma validação, mesmo `touchUserData`. Apagar é definitivo (a tela também apaga de vez).
- Editar e apagar nunca são limitados por plano (princípio do produto).
- Identidade só do JWT ou do vínculo do WhatsApp. Toda busca, leitura e escrita leva `id + userId` no `where`. Id de outra conta = "não encontrado", sem revelar se existe.
- Escrita pelo WhatsApp segue a mesma trava dos outros fluxos (`WHATSAPP_WRITES_ENABLED`).

## 2. Frases (intenção nova `edit_transaction` e `delete_transaction`)
- Apagar: `apagar`, `excluir`, `remover` + opcional `lancamento` + termo livre e/ou valor. Ex.: `apagar mercado`, `excluir lançamento 50`, `remover 32,90 farmácia`.
- Editar: `editar`, `corrigir`, `alterar` + o mesmo. Ex.: `corrigir mercado`.
- Comando curto: até 6 palavras e sem `?` (mesmo padrão das metas). Acima disso ou com `?` é conversa livre (vai ao Selah, como hoje). "apagar conta" sem termo vira pergunta "qual lançamento?" (campo pendente). Não colidir com `cancelar` nem com frases existentes (`criar meta` etc.): manter todos os testes atuais do matcher verdes.
- Verbos soltos sem substantivo claro dentro de rascunho em andamento continuam valendo como hoje (rascunho tem prioridade, como já é com outras intenções).

## 3. Busca e lista
- Candidatos: lançamentos do usuário dos últimos 180 dias cujo texto (descrição ou nome da categoria, sem acento e sem caixa) contém o termo e/ou cujo valor é igual ao valor informado. Ordem: data desc, depois createdAt desc. Máximo 5.
- Elegíveis só os lançamentos "manuais": sem `recurringTransactionId`, sem `installmentPurchaseId`, sem `linkedGoalId` e sem ReceiptScan. Os não elegíveis não entram na lista; se TODOS os achados forem não elegíveis, a resposta diz "esse lançamento veio de conta fixa, parcelado, meta ou nota; altere pela tela" (sem ids).
- Lista: texto `1) 50,00 · Mercado · 18/11` (valor, descrição, data; categoria se houver) + `quickReplies` com `1`..`N` e `cancelar`. Nenhum resultado: resposta INFO "não achei" e sem sessão.
- O rascunho guarda só os ids candidatos (máx. 5) e a ação; ao escolher o número, o item é relido do banco com `id + userId`.

## 4. Fluxo de apagar
1. Lista numerada (estado COLLECTING_FIELDS, intent `delete_transaction`, campo pendente `transaction`).
2. Usuário responde o número (1..N). Número fora da lista = pede de novo. Outro texto que não seja comando conhecido = pede de novo (sem sair).
3. Prévia exata em AWAITING_CONFIRMATION: valor, descrição, categoria, data, forma de pagamento + aviso "Isto apaga de vez e não dá para desfazer."
4. **Confirmação reforçada:** só vale a palavra `apagar` (normalizada, sozinha). `confirmar`, `sim`, `ok` NÃO apagam e a resposta lembra "para apagar, responda apagar". No app o botão do cartão deve enviar essa palavra/ação equivalente; o endpoint de confirmar por botão só aceita a ação de apagar quando vier explícita (ver brief).
5. Aplicação em transação do banco: relê `id + userId`; se não existir mais, resposta ERROR "não encontrei mais esse lançamento" e nada é apagado; se existir, apaga e devolve recibo (`data.transactionId`, texto "Apaguei: ..."). Chave de idempotência como nos outros fluxos (`appliedKey`), repetir a confirmação não apaga duas vezes.
6. Falha auxiliar depois do commit (touchUserData, notificação) não desfaz nem repete. Resultado desconhecido: orientar a conferir a tela, sem repetir.

## 5. Fluxo de editar
1. Lista numerada (intent `edit_transaction`, mesmo mecanismo).
2. Escolhido o número, pergunta "O que mudar? valor, descrição, categoria ou data". O usuário manda uma ou mais mensagens: `valor 45`, `descrição padaria`, `categoria mercado`, `data 15/11`. Reusar os parsers atuais (amount, date, categoria por nome com a mesma ambiguidade/opções do fluxo de criar). Tipo (receita/despesa), forma de pagamento, meta, tarefa e reserva NÃO são editáveis aqui.
3. Cada mudança atualiza o rascunho (sobe `version`) e mostra a prévia "antes -> depois" por campo alterado; `confirmar` aplica; `cancelar` descarta. Sem nenhuma mudança, `confirmar` responde "nada para mudar".
4. Aplicação: relê `id + userId`, compara `updatedAt` com o do momento em que o item foi escolhido; se mudou (alguém editou pela tela), ERROR "esse lançamento mudou; refaça" e nada é gravado. Senão chama `TransactionsService.update` com só os campos mudados. Recibo `data.transactionId`. Mesmas regras de falha auxiliar e resultado desconhecido do apagar.
5. Valor zero, negativo ou acima do máximo seguem as mesmas mensagens do criar.

## 6. Sessão e estado
- Reusa `ConversationSession` (uma por usuário e canal), expiração igual à dos outros rascunhos. Nova `DraftKind`: `TRANSACTION_CHANGE` com `{ action: 'EDIT'|'DELETE', candidateIds: string[], targetId: string|null, targetUpdatedAt: string|null, changes: {amountCents?, description?, categoryId?, date?}, pendingField: 'transaction'|'change'|null }`. Sem migration de banco (o `draft` é Json). `DraftView` e `rows` formatados, sem ids internos além de draftId/draftVersion.
- Se já existe rascunho em andamento de outro tipo, vale a regra atual do motor para novo comando (não inventar regra nova; registrar em duvidas.md o que o motor faz hoje).
- Eventos (`ConversationEvent`) com intent `edit_transaction`/`delete_transaction` e outcome RECOGNIZED/COMPLETED/CANCELLED/EXPIRED; nunca o texto da mensagem.

## 7. Segurança e privacidade
- Logs sem valor, descrição, categoria ou ids de outra conta; só intenção, resultado e nome do erro.
- Testes A/B/C obrigatórios: em app e WhatsApp, tentar apagar/editar por candidato de outra conta (rascunho forjado, número escolhido apontando para id de B, token/corpo com `userId` trocado) e confirmar rascunho de B com sessão de A; tudo falha sem revelar existência. Entram na `isolation.fixture.ts`/`isolation.spec.ts`.
- Confirmar duas vezes, e duas confirmações paralelas: uma só aplicação.
- A LLM não participa: sem escrita por IA, sem texto do lançamento indo ao Selah.

## 8. Fora do 8a
Metas/reservas (8b), recorrência/conta fixa/parcelado (8c), limite do cartão (8d), "apagar o último", apagar vários de uma vez, desfazer, editar tipo/pagamento/vínculos, edição de lançamento de nota importada.

## 9. Critérios de aceite
- Backend: `tsc` 0, `nest build`, `npx jest` inteiro (`--maxWorkers=2`), `src/conversation` em UTC, America/Sao_Paulo e Asia/Tokyo; mutantes injetados e mortos (mínimo: sem `userId` na busca, sem `userId` na aplicação, `confirmar` apagando, não checar `updatedAt`, não excluir os não elegíveis, idempotência removida, ordem/limite da lista); integração real em Postgres 16 e Redis 7 descartáveis (concorrência, duas contas, falha injetada).
- Frontend: cartão mostra a lista numerada e a prévia sem quebrar; botão do apagar manda a ação reforçada; `ng test` e `npm run build`. 
- Relatório de revisão persistido em `.superpowers/sdd/conversa-item-8a/` com seção NÃO verificado.
