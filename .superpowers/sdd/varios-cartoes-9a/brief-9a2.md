# Brief 9a-2: cardId em lancamento, parcelado e recorrencia (branch feat/varios-cartoes)

Leia: CLAUDE.md, docs/superpowers/specs/2026-11-23-conversa-contrato-item-9.md (aprovado; secoes 2, 4 e 5), .superpowers/sdd/varios-cartoes-9a/resultado-9a1.md e duvidas.md. A 9a-1 ja criou CreditCard, as colunas cardId (opcionais) em Transaction, InstallmentPurchase e RecurringTransaction e o calculo do ciclo por cartao. Docker esta DESLIGADO nesta maquina: nao ha Postgres real; teste so com mocks (padrao dos specs existentes) e diga o que nao verificou.

## Escopo
1. **DTOs** de criar/atualizar lancamento (transactions), parcelado (installments) e recorrencia (recurring-transactions): `cardId` opcional (UUID, nullable na atualizacao para limpar).
2. **Validacao no servico, na mesma transacao da escrita** (padrao FOR NO KEY UPDATE ja usado; nao crie deadlock com o lock do User da 9a-1: mantenha uma ordem unica de locks e documente em comentario): cardId so com paymentMethod=CREDIT (senao 400 claro); o cartao precisa ser do usuario do token (de outro usuario ou inexistente = 404, mesma mensagem nos dois casos, para nao revelar existencia); cartao arquivado nao aceita NOVO lancamento (400); na atualizacao, manter um cardId ja gravado que depois foi arquivado e permitido (nao mexe no historico) e se o paymentMethod sair de CREDIT o cardId e limpo (null).
3. **Heranca**: parcelas geradas (installment-materializer) e lancamentos gerados por recorrencia (recurring-materializer) herdam o cardId do modelo. Editar o modelo recorrente so afeta os proximos (regra ja existente). Cartao arquivado depois nao impede materializar o que ja estava contratado.
4. **Leitura**: respostas de lancamento, parcelado e recorrencia devolvem `cardId` e `cardName` (null quando nao ha). Filtro opcional `cardId` na listagem de lancamentos (so do dono; cartao alheio = 404). Sem N+1: um include/select do nome.
5. **Insights** (insights.service.ts): o gasto do ciclo do cartao padrao deve seguir a regra da secao 4 itens 3 e 4 do contrato (EXPENSE CREDIT com cardId nulo OU igual ao id do padrao; com countAllPayments toda EXPENSE). Hoje soma todo CREDIT; com cartoes diferentes isso estaria errado. Reuse a mesma funcao/where do CreditCycleService (extraia para um helper compartilhado em credit-cycle em vez de duplicar).
6. **Exportacao de dados do usuario** e qualquer lugar que serialize Transaction por completo: confira (grep) se cardId precisa entrar; se entrar, inclua. Nao mude contratos de resposta existentes alem de acrescentar campos.
7. **Conversation** (src/conversation) NAO muda: lancamentos por conversa ficam sem cardId (contam no padrao). Seus testes devem continuar verdes.
8. Swagger dos DTOs com ApiPropertyOptional.

## Testes (jest, 2 workers no maximo)
- Por servico (transactions, installments, recurring): cardId valido grava e devolve cardName; cardId alheio e inexistente = 404 identico; cardId com DEBIT/PIX = 400; arquivado em criacao = 400; arquivado ja gravado em update = ok; sair de CREDIT limpa; isolamento A/B/C (A nunca ve nem usa cartao de B; listagem filtrada por cardId de B = 404).
- Materializers: heranca do cardId (parcelas e recorrencias).
- Insights/ciclo: gasto do padrao conta cardId nulo + padrao e NAO conta outro cartao; cartao secundario so conta o seu; countAllPayments soma tudo.
- Rode: cd backend && npx tsc --noEmit && npx jest src/transactions src/installments src/recurring-transactions src/credit-cycle src/credit-cards src/insights src/conversation src/users --maxWorkers=2 em TZ=UTC, America/Sao_Paulo e Asia/Tokyo; depois a suite inteira (--maxWorkers=2) uma vez. Specs de materializer com data: 15 execucoes seguidas.
- Mutantes: injete pelo menos 15 (ex.: remover a checagem de dono, aceitar cardId com DEBIT, nao herdar nas parcelas, nao limpar ao sair de CREDIT, padrao nao contar nulo, secundario contar nulo) e registre mortos, sobreviventes e equivalentes; escreva testes para os sobreviventes.

## Regras
- Comentarios/logs em portugues sem acentos no codigo. Sem dependencia nova. Nada de nome de cartao nem valor em log.
- NAO mexa em migration nem schema (as colunas ja existem); se achar que precisa, pare e escreva em .superpowers/sdd/varios-cartoes-9a/duvidas-9a2.md.
- Commits separados com caminhos explicitos (dto+servico por dominio; materializers; insights/helper; testes; docs), Conventional Commits em portugues, com Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>. Nunca amend/reset/push. index.lock: espere e repita. Nao toque em .env, containers ou portas de outros projetos.
- Depois do codigo: graphify update . na raiz.
- Termine com .superpowers/sdd/varios-cartoes-9a/resultado-9a2.md (mudancas, comandos e numeros, NAO verificado: migration e integracao real por falta de Docker). Se parar por limite, diga onde parou. Nao pergunte nada: o dono ja aprovou o contrato.
