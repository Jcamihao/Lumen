# Brief de implementação, BACKEND: item 3b2b (conta fixa e compra parcelada)

Para: subagente de desenvolvimento (haiku). Relatório final em estilo curto, sem enfeite. Código, comentários e textos de tela em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Data: 2026-11-16.

O dono validou o contrato do 3b2. O 3b2a (reserva e limite do cartão) já está pronto, revisado e commitado: **é o modelo a imitar**. Este item acrescenta `create_recurring` (criar conta fixa) e `create_installment` (criar parcelado) ao motor, com confirmação e a mesma proteção contra falhas posteriores à gravação. Não mexa em frontend, em reservas, limite, metas ou lançamentos.

## Leia antes de escrever código (nesta ordem)

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md`: **fonte única**. Seções 1 a 7 e 9. Gramática na seção 4; rascunhos e cartões na seção 5 (Conta fixa e Compra parcelada); planos na seção 6.
2. `.superpowers/sdd/conversa-item-3b2a/resultado-revisao.md`, `brief-backend.md` e `contrato-tipos.md` (seção 5): o padrão de três resultados de gravação, condição revisável, recibo e `reviewReason`. É a referência de como fazer.
3. O código do 3b2a, para copiar o padrão (não reinvente):
   - Domínio: `backend/src/envelopes/envelopes.service.ts` (`persistEnvelope`, `createForConversation`, `refreshAfterCreate`) e `backend/src/envelopes/conversation-write.types.ts`; `backend/src/credit-cycle/credit-cycle.service.ts` (`persistCeiling`, `setCeilingForConversation`) e `conversation-write.types.ts`.
   - Motor, em `backend/src/conversation/conversation.service.ts`: `startEnvelopeDraft`, `startCreditLimitDraft`, `saveNewDraft`, `handleWithSession`, `fillPendingField`, `answerPending`/`answerEnvelope`, `applyDraft`, `reviseDraft`, `applyByKind`/`applyEnvelope`/`applyCreditLimit`, `restoreSession`, `draftReply`, `confirmationText`, `questionFor`, `toDraftView`. Também `parsers/intent.matcher.ts`, `parsers/envelope.parser.ts`, `parsers/date.parser.ts`, `parsers/amount.parser.ts`, `replies.ts`, `conversation.types.ts`.
4. Serviços a alterar: `backend/src/recurring-transactions/recurring-transactions.service.ts` (`create`, `parseDateOnly`), `backend/src/installments/installments.service.ts` (`create`, `toInstallmentResponse`), os materializadores `recurring-materializer.service.ts` e `installment-materializer.service.ts` (só leitura, não altere), `recurrence.util.ts` (`localToday`, `utcDate`, `nextOccurrence`, `addDaysUtc`), os DTOs de criação e `backend/src/billing/entitlements.service.ts`.

Consulte o grafo (`graphify query`) antes de explorar o código.

## 1. Serviços de domínio (sem rota nem DTO HTTP novos)

Para cada serviço, extraia um **núcleo privado de gravação** compartilhado entre o método da tela (`create`) e um novo método para o bot, como o 3b2a fez:

```ts
RecurringTransactionsService.createForConversation(userId, dto, rules)   // devolve RecurringWriteReceipt
InstallmentsService.createForConversation(userId, dto, rules)            // devolve InstallmentWriteReceipt
```

Formas exatas dos recibos e dos erros ficam em novos `conversation-write.types.ts` de cada módulo (o domínio não importa nada do módulo de conversa), com o formato que o contrato de tipos (seção abaixo) descrever. O recibo contém só o que foi persistido: id, descrição, valores em centavos, datas `AAAA-MM-DD`, e **flags** do que ocorreu depois do commit (`materializationPending`, `refreshPending`). Não dependa de `findOwned`/`toRecurringResponse`/`toInstallmentResponse` depois da gravação para montar o recibo do bot; o método da tela continua devolvendo a resposta atual (formato inalterado).

### Núcleo de gravação (cada serviço)

1. Validar no domínio (a chamada interna não passa pelo `ValidationPipe`): descrição aparada de 2 a 120 caracteres, valor positivo com até 2 casas, limites dos DTOs; frequência válida (conta fixa); contagem inteira de 2 a 60 (parcelado).
2. `assertCanCreate(userId, 'recurringTransactions' | 'installmentPurchases')` antes de gravar (o motor também checa ao abrir o rascunho).
3. Um **relógio único** no núcleo (`now`), `localToday(now, timezone do dono)`; reaproveite a lógica de datas atual: não anterior ao mês passado e no máximo dois anos à frente (mensagens já existentes), mais a regra do bot (parâmetro `rules.notBefore: 'today'`): primeiro vencimento **anterior a hoje** não grava e lança a condição revisável `…FirstDueChangedError` com o `today` do núcleo.
4. Gravação dentro de `$transaction` (uma única escrita, mas é o que permite distinguir rollback conhecido de **commit de resultado desconhecido**): use o padrão `callbackFinished` do 3b2a para lançar `…WriteUncertainError` quando o callback terminou e a promise rejeitou.
5. Depois do commit, cada etapa abaixo é **tratada separadamente e não derruba o sucesso**: `materializeDue(userId)` → falha marca `materializationPending: true` (registre só operação e `error.name` com `Logger`, nunca valores); `touchUserData` → falha marca `refreshPending: true`. Para a tela (`create` HTTP), mantenha o comportamento atual de chamar a materialização e devolver o item, mas sem relançar erro pós-gravação (mesma decisão do 3b2a para reservas; registre em `duvidas.md`).
6. Parcelado, regra nova (vale para a tela também): `installmentAmount = round(total / n, 2)`, última parcela = `total − installmentAmount × (n − 1)`; **rejeite com `BadRequestException`** quando qualquer parcela ficar menor que R$ 0,01 (inclui última zero ou negativa). Exemplo de regressão: R$ 1,00 em 60 vezes. Mensagem em português curta e segura.
7. Mensal no dia 31 passa pelo último dia de meses curtos e volta à âncora 31, como a tela (reaproveite `nextOccurrence`; não altere o calendário global).

Unicidade de calendário já existente (uma ocorrência por regra/data; uma parcela por compra/número) não pode ser enfraquecida.

## 2. Motor e gramática (`backend/src/conversation/`)

Seção 4 do contrato. Prefixos: `criar conta fixa`, `nova conta fixa` → `create_recurring`; `criar parcelado`, `novo parcelado` → `create_installment`. Até 20 palavras, sem `?`, dentro dos 500 caracteres; frase longa ou interrogativa não vira escrita (segue a regra de não reconhecimento). Não altere os limites de metas/aportes/reservas/limite nem as leituras (`contas fixas`, `parcelas` etc. continuam leituras). Prefixo isolado inicia a coleta.

- **Conta fixa**: `[valor inicial] <descrição> [mensal|semanal|anual] [primeiro <data>]`. Frequência e data são **sufixos delimitados**; não remova uma palavra coincidente no meio da descrição. Frequência ausente = `MONTHLY`, e aparece no cartão. Despesa sempre (`type: 'EXPENSE'`); sem categoria, pagamento nem data final.
- **Parcelado**: `[total inicial] <descrição> [em <N>x] [primeiro <data>]`. O valor é sempre o **total** da compra: `12x de 100` não é lido como total R$ 100 (peça o total). Categoria e pagamento nulos; não presuma crédito.
- **Datas aceitas**: `hoje`, `dd/mm` (ano atual, sem saltar para o próximo), `dd/mm/aaaa`, validação de calendário do parser existente. `amanhã`, `dia 5`, ISO, duas datas ou outras expressões pedem uma data completa. Data **anterior a hoje** é recusada com a orientação do contrato (cadastrar o histórico pela tela); nunca troque por hoje em silêncio. O limite de dois anos vem do núcleo do serviço.
- **Ordem de coleta**: descrição → valor → quantidade de parcelas (só parcelado) → primeiro vencimento. Antes do parser de comandos novos, o **campo pendente decide** se um número é valor, quantidade ou opção; texto que começa com número é aceito como descrição quando o campo pendente é a descrição. Em respostas a campo de valor, o valor deve consumir toda a resposta (sobra pede reenvio). Quantidade: inteiro de 2 a 60 (aceite `12` e `12x`; `1`, `61`, fracionário, vazio pedem reenvio). Controles (`confirmar`, `cancelar`), leituras e outro comando de escrita mantêm a prioridade já contratada; outro comando de escrita não substitui o rascunho.
- **Rascunhos** (seção 5 do contrato): `RecurringDraft` (`kind: 'RECURRING'`) e `InstallmentDraft` (`kind: 'INSTALLMENT'`), com `reviewReason?` como nos do 3b2a e dinheiro em centavos. `DraftKind` e `PendingField` estendidos só com o necessário (`installmentsTotal`, `firstDueDate`; `description` e `amount` já existem). `ReplyData` ganha `recurringTransactionId?` e `installmentPurchaseId?`.
- **Planos**: `assertCanCreate` ao abrir cada rascunho (recursos `recurringTransactions` e `installmentPurchases`); sem limite numérico fixo no motor; `PlanLimitException` recusa ao abrir, sem rascunho, com a mensagem dela.
- **Cartões** (`DraftView`: `kind`, `title`, `rows`, avisos; campos legados nulos): conta fixa = título `Conta fixa`, linhas Descrição, Valor por vencimento, Frequência, Primeiro vencimento, Categoria (`não informada`), Forma de pagamento (`não informada`), Aviso. Parcelado = título `Compra parcelada`, linhas Descrição, Total da compra, Quantidade, Valor por parcela, Última parcela, Primeiro vencimento, Categoria, Forma de pagamento, Aviso. Avisos do contrato: vencimento hoje ("Ao confirmar, será gerado o lançamento de hoje." / de parcelado, equivalente) e futuro ("Os lançamentos serão gerados nos vencimentos."); acrescente que outros cadastros já vencidos do próprio usuário podem ser atualizados junto (a tela também faz). Campo ausente = `a informar`; `reviewReason` vira linha `Atenção`, também ao restaurar a sessão e em `GET /conversation/session`.
- **Confirmação**: mesmo algoritmo do item 1 (reivindicar, `appliedKey`, aplicar) e os **três resultados** do 3b2a: persistiu (`DONE` com aviso de materialização/atualização pendente quando houver), não persistiu comprovadamente (D5: 4xx e plano descartam; erro inesperado restaura), commit desconhecido (`ERROR`/`IDLE`, sem restaurar, sem liberar a chave). **Condição revisável nova**: primeiro vencimento ficou no passado entre rascunho e confirmação → sem gravar, `version + 1`, estado de coleta pedindo novo vencimento (`pendingField: 'firstDueDate'`), 15 minutos, `reviewReason` explicando; se outro rascunho foi aberto no intervalo, não sobrescreva (mensagem segura pedindo refazer).
- **DONE**: texto a partir do recibo, nunca só do rascunho. Conta fixa: "Conta fixa criada: internet, R$ 120,00, mensal, primeiro vencimento em DD/MM/AAAA." Parcelado: "Compra parcelada criada: geladeira, total R$ 1.200,00 em 12 parcelas, primeira em DD/MM/AAAA." Só afirme "o lançamento de hoje foi gerado" quando a materialização terminou sem falha; com falha use: "Cadastro salvo. A atualização dos lançamentos está pendente; confira a tela de Finanças." `data.recurringTransactionId` / `data.installmentPurchaseId`; `resultRef` = esse id. Sem saldo nem contagem inventados.

## 3. Segurança e regras que não podem quebrar

- `userId` só do argumento do motor; nunca do texto. Nenhuma escrita sem rascunho completo e `confirmar`. Confirmar/cancelar rascunho alheio continua 404/`null` idêntico ao inexistente.
- O motor não grava nada direto no Prisma para essas ações: só pelos dois novos métodos de serviço.
- Dinheiro em centavos inteiros no rascunho; reais só na fronteira da chamada.
- Sem texto de mensagem, descrição ou valor em evento nem em log; log só com id da intenção/operação e `error.name`.
- Constantes nomeadas no topo (20 palavras, 2 a 60 parcelas, 2 a 120 caracteres).

## 4. Testes (jest, no estilo dos specs existentes; relógio travado como o spec do motor)

Contrato, seção 7, itens 1 a 8 do 3b2b, em especial:
- Matcher/parser: prefixos completos e incompletos, 20/21 palavras, `?`, leituras preservadas, perguntas naturais que não viram escrita, sufixos de frequência e data sem remover palavra do meio da descrição, `12x de 100` pede o total, `gastei`/metas/aportes/reservas sem regressão.
- Valores, quantidade 1/2/60/61/fracionária, divisão que geraria parcela zero/negativa (R$ 1,00 em 60) recusada **no serviço** e na tela; datas em UTC, São Paulo e Tóquio: hoje, 1º do mês, 31/02, ano omitido sem saltar de ano, passada recusada, teto de dois anos, rascunho atravessando a meia-noite.
- Motor: campos faltantes e ordem de coleta, número como valor/quantidade/descrição conforme o campo pendente, restauração, cancelamento, 15/5 minutos, leituras sem substituir rascunho, plano ao abrir e ao confirmar, A/B, confirmar em paralelo (um cadastro, uma chamada ao serviço), versão antiga, `messageId` repetido.
- Escrita/domínio: três resultados (persistiu com materialização falhando e com `touchUserData` falhando; rollback conhecido; commit desconhecido sem restaurar nem liberar a chave); condição de data passada sem gravar; nova confirmação grava uma vez; formato das respostas HTTP da tela inalterado (`create` de ambos).
- Mutantes (faça cada um sozinho e desfaça): outro `userId` nos dois métodos; remover `assertCanCreate` ao abrir e no serviço; remover a checagem `notBefore`; restaurar o rascunho após commit desconhecido; liberar `appliedKey`; recibo dependendo de leitura posterior; remover a validação de parcela mínima; remover `AWAITING_CONFIRMATION`/reivindicação/`appliedKey`.

## 5. Verificação (rode e cole a saída com os números reais desta execução)

Em `backend/`: `npx tsc --noEmit`; `npx jest src/conversation src/recurring-transactions src/installments`; `npx jest` inteiro (hoje 46 suites, 1056 testes: confira o número real); `npx nest build`; os três módulos acima em `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`. Lint: o backend não tem configuração ESLint no repositório; não crie nem commite uma. O agente principal roda `graphify update .`; você não roda.

## 6. Caminhos autorizados e proibições

Permitidos: `backend/src/conversation/` (service, types, matcher, replies, novo parser de conta fixa/parcelado se ajudar, specs), `backend/src/recurring-transactions/recurring-transactions.service.{ts,spec.ts}` + novo `conversation-write.types.ts`, `backend/src/installments/installments.service.{ts,spec.ts}` + novo `conversation-write.types.ts`, e documentos desta pasta. Materializadores e `recurrence.util.ts` só se um bug concreto exigir (registre em `duvidas.md` e avise).

Proibido: frontend, controllers, DTOs HTTP, schema/migration, billing/catálogo, metas, reservas, limite, `.env`, dependência npm, commit/push/amend/reset/deploy. **Nada de banco real**: só testes unitários com mocks; nunca conecte em Postgres/Redis; a porta 55439 é o Postgres de outro projeto (Bora) com dados reais e a 3001 é de outro projeto.

Dúvida ou conflito com o contrato: registre em `.superpowers/sdd/conversa-item-3b2b/duvidas.md` e pare naquele ponto; não decida sozinho. Se precisar de schema, nova idempotência persistida ou mudança de produto, registre a evidência e volte ao agente principal.

## 7. Entregas

1. Código e testes verdes, sem commit.
2. `.superpowers/sdd/conversa-item-3b2b/contrato-tipos.md` com o formato **final** de `DraftView` (`rows`, `pendingField`, `reviewReason`) e dos textos de `DONE`/erro/condição revisável, com JSONs reais copiados de uma execução de teste: conta fixa completa, parcelado completo, pendência de cada campo, revisão por data passada, `DONE` com e sem aviso de materialização, erro de commit desconhecido. O frontend usa esse arquivo.
3. Relatório final curto: arquivos alterados, comandos e números reais, bugs achados, decisões onde o contrato era omisso, o que NÃO foi verificado.
