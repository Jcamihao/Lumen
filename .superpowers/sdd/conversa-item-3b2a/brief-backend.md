# Brief de implementação: 3b2a, reservas e limite do cartão

Data: 2026-11-15. Estado: preparado, ainda não implementado.
Projeto: `/home/caminhao/coding/codeStage/Lumen`.

O dono validou o contrato do 3b2. Este brief detalha a primeira entrega: `create_envelope` e `set_credit_limit`, com confirmação e proteção contra falhas posteriores à gravação. Não implementar contas fixas/parcelados, que pertencem ao 3b2b.

## Leitura e responsabilidade

Leia `/home/caminhao/.claude/CLAUDE.md`, o contrato `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md`, o contrato do item 1, o relatório do 3b1 e `contrato-tipos.md` desta pasta. Consulte o grafo antes de explorar o código.

O desenvolvimento do backend trabalha somente nos caminhos da seção final. O frontend recebe seu próprio brief, após os tipos estarem conferidos. Um subagente por vez. Use os modelos indicados pelo dono quando disponíveis; se não estiverem disponíveis, informe o limite e não atribua a execução a um modelo que não foi usado.

Registre decisões técnicas e dúvidas em `duvidas.md` desta pasta. Mudança no contrato precisa constar no arquivo e ser comunicada ao agente principal. Não fazer commit, push, deploy, migration, alteração de `.env` ou instalação de dependências no projeto.

## 1. Motor e gramática

Adicionar somente as intenções e tipos desta entrega. Prefixos: `criar reserva`, `nova reserva`, `criar envelope`; `definir limite do cartão` antes de `definir limite`. Comandos novos têm até 20 palavras, sem `?`, dentro dos 500 caracteres existentes. Não alterar o limite de seis palavras das metas/aportes nem as leituras anteriores.

Reserva aceita valor inicial seguido de nome, apenas nome, apenas valor ou corpo vazio. Só nome pergunta valor; só valor pergunta nome; vazio pergunta nome e depois valor. Não inferir valor ao final do nome. Exemplos: `criar reserva 400 gasolina`, `nova reserva gasolina`, `criar envelope 3 mil viagem`. Nome de 2 a 60 code points, aparado, com números preservados.

Limite aceita somente um valor completo; corpo vazio pergunta. `definir limite 5000 Nubank` pede reenvio, sem ignorar o banco. `limite do cartão`, `cartão` e perguntas continuam leituras/conversa. Reutilizar o parser de valores e o teto inclusivo de R$ 1 milhão; valor ambíguo, zero ou negativo não abre confirmação.

Durante coleta de nome, texto numérico sozinho é nome, não novo lançamento. Controle explícito (`confirmar`, `cancelar`), leituras e outro comando de escrita continuam com a prioridade contratada; outro comando não substitui o rascunho. Resposta ao campo de valor precisa ser consumida inteira pelo parser.

Checar `EntitlementsService.assertCanCreate(userId, 'envelopes')` ao abrir o rascunho e no serviço ao confirmar. Usar o catálogo, sem limite numérico fixo no motor. Definir teto do ciclo não consome vaga de plano. Duplicidade de nome considera a unicidade vigente `userId + name`, não uma unicidade sem acentos ou caixa inventada pelo bot.

## 2. Separar persistência e enriquecimento nos serviços

Introduzir métodos internos ao backend, sem novas rotas nem DTOs HTTP:

```ts
EnvelopesService.createForConversation(userId, dto, expectedProvisionMonth)
CreditCycleService.setCeilingForConversation(userId, dto, expected)
```

As formas exatas dos resultados ficam em `contrato-tipos.md`. Esses métodos retornam um recibo do que efetivamente foi persistido, com ids internos e valores em centavos. Não devem depender de `toResponse()` ou `getCurrent()` executados depois da gravação. O retorno ao motor não informa saldo disponível, gasto ou percentual quando não houve leitura bem-sucedida.

Extrair um núcleo privado de gravação em cada serviço e compartilhá-lo com os métodos existentes `create`/`setCeiling`. Não copiar as regras do domínio para `ConversationService` nem manter duas implementações de gravação. As respostas HTTP atuais das telas mantêm sua forma; o caminho do bot usa o recibo explícito. Não introduzir um framework genérico de comandos ou uma interface de repositório nova.

### Reserva

O núcleo de gravação verifica o plano e cria envelope ativo e a provisão inicial na mesma transação Prisma. A provisão é `EnvelopeTopUp` do mês UTC usado atualmente pelo domínio, não uma transação financeira de saída. Usar a unicidade existente de envelope/mês; falha na provisão inicial deve reverter também o envelope.

Fixar a cor `#f18f01`, primeira cor da tela; sem ícone. Validar a entrada no domínio, pois a chamada interna não passa pelo `ValidationPipe` HTTP. Converter centavos para reais somente na fronteira da chamada do serviço. A checagem nominal de plano mantém a tolerância de concorrência já documentada em `EntitlementsService`; não prometer quota serializável nesta entrega.

O mês mostrado no rascunho fica em `provisionMonth`, uma data `AAAA-MM-01` UTC. O serviço calcula seu relógio e confere o mês dentro do núcleo de gravação. Se mudou, retorna a condição de revisão descrita abaixo, sem gravar; o motor mostra o novo mês e exige outra confirmação. Isso evita confirmar uma provisão de outro mês com o cartão antigo.

Depois do commit, atualização de dados derivados falhando apenas marca `refreshPending: true` e registra operação/nome do erro. Não chamar uma agregação falível para montar o recibo. No caminho HTTP atual, manter o enriquecimento da resposta separado do núcleo; testar sua compatibilidade, sem alegar que o recibo do bot substitui o formato da tela.

### Limite do cartão

O núcleo do serviço usa transação e bloqueio parametrizado da linha `User` pelo `userId`. Sob esse bloqueio, lê timezone, fechamento e `creditCycleCountAllPayments`; captura o relógio uma vez e reutiliza `localToday` + `creditCycleBounds`. Não recalcular o destino depois com outro relógio.

Ler o teto da chave composta do dono/ciclo na mesma transação. Comparar com o rascunho: início/fim do ciclo, teto vigente ou ausência de teto, e `countAllPayments`. `previousCeilingCents` é o teto deste ciclo observado no cartão, não a sugestão de um ciclo anterior.

O `upsert` só acontece se a pré-condição inteira ainda valer. O método usado pela tela também compartilha esse núcleo e o bloqueio, para não permitir que um segundo escritor ignore a proteção. Atualizações normais dos campos de `User` já adquirem bloqueio de linha no Postgres; não modificar `UsersService` sem um achado concreto comunicado ao principal.

Se a pré-condição mudou, não há upsert. O serviço devolve uma condição específica de revisão com o novo snapshot. O destino é sempre a chave composta do ciclo validado; jamais o novo ciclo recalculado silenciosamente. Não alterar fechamento, vencimento ou `countAllPayments` neste comando.

Após o commit, tratar atualização de dados derivados como efeito auxiliar. O recibo inclui o id da linha `CreditCycleCeiling` retornado pelo upsert, o valor e o ciclo realmente gravados. Para o `DONE` desta primeira versão não é preciso reler `getCurrent`: omitir `data.card` em vez de fabricar saldo/gasto.

## 3. Três resultados de gravação e revisão da confirmação

Não aplicar automaticamente o catch atual de `applyDraft`, que restaura qualquer erro inesperado, às novas ações sem distinguir estes casos:

1. **Persistiu:** recibo válido. Responder `DONE`, consumir o rascunho e registrar `resultRef`; com `refreshPending`, acrescentar aviso para conferir a tela. Falha da métrica posterior não transforma a ação em erro financeiro.
2. **Não persistiu, comprovadamente:** validação/plano/duplicidade seguem D5; falha inesperada com rollback confirmado pode restaurar. Falha dentro do callback da transação, antes de tentar commit, não deve emitir um recibo de sucesso.
3. **Resultado do commit desconhecido:** não restaurar, não liberar `appliedKey`, não responder `DONE`. Responder `ERROR`/`IDLE`: "Não foi possível confirmar o resultado. Confira a tela de Finanças antes de enviar o pedido novamente." Não oferecer botão de confirmar ou retry de gravação. A regra só trata as novas ações, sem reescrever o comportamento dos itens anteriores neste recorte.

Cada serviço deve distinguir a fase em que falhou. Se o callback terminou e a confirmação do commit falhou, classificar conservadoramente como resultado desconhecido; nunca inferir rollback apenas porque a promise de `$transaction` rejeitou. Classes/erros pequenos de domínio podem ficar nos arquivos `conversation-write.types.ts` dos dois módulos, sem dependência do domínio para o módulo de conversa e sem transportar mensagens de banco ao usuário. Não criar uma hierarquia genérica de erros.

**Condição revisável, sem gravação:** mudança de mês da reserva ou de snapshot do cartão. Tratar separadamente antes do catch D5: liberar a chave da tentativa que comprovadamente não gravou, restaurar a sessão com os novos dados, `version + 1` e novo prazo de cinco minutos; responder `CONFIRM_DRAFT` com prefixo explicativo. Preservar o valor que o usuário pediu e exigir nova confirmação. Se outro rascunho já foi aberto durante a reivindicação, não sobrescrevê-lo; responder erro seguro pedindo refazer a solicitação.

Versão antiga, reentrega de `messageId` ou confirmação concorrente nunca pode aplicar o rascunho atualizado. Na condição de commit desconhecido, conservar o evento/chave impede a repetição da mesma versão, mas não recupera automaticamente o resultado nem impede um novo pedido intencional do usuário; registrar esse limite.

## 4. Cartões e mensagens

Montar `DraftView` exatamente conforme `contrato-tipos.md`; `rows` e avisos precisam estar completos tanto na resposta da mensagem quanto em `GET /conversation/session`. Não adicionar campo visual de implementação como status de transação/SQL.

Reserva: nome, valor mensal, mês UTC de início e aviso sobre provisão. Limite: ciclo, teto observado, novo teto e avisos de validade por ciclo e de todas as formas de pagamento quando a opção estiver ligada.

O texto de `DONE` usa o recibo confirmado, nunca apenas o rascunho original. Reserva leva `data.envelopeId` e `resultRef = envelopeId`; limite usa `resultRef = creditCycleCeilingId`, com `data: {}` quando não houver leitura de cartão atual. Não colocar ids internos nas linhas do cartão.

## 5. Testes do desenvolvimento

- Matcher e parser: todos os prefixos; 20/21 palavras; `?`; leituras preservadas; ambíguo, zero, negativo, milhão e acima; sobra de texto no limite; número em nome durante coleta; nome de 1/2/60/61 code points.
- Motor: campos faltantes, rascunhos/restauração, cancelamento, 15/5 minutos, leituras sem substituir rascunho, limite do plano ao abrir/confirmar, conflito de nome entre contas e no mesmo dono.
- Escrita: duas confirmações e confirmação em paralelo criam uma reserva e uma provisão; limite usa o id/ciclo do recibo; argumentos sempre com o dono autenticado.
- Domínio: envelope/provisão na mesma transação; provisão falha e não há sucesso; efeito auxiliar falha pós-commit e o recibo continua sucesso, com aviso; API existente preserva o formato esperado.
- Ciclo/mês: mudança de ciclo, fechamento, opção de todas as formas e teto concorrente exige nova versão; mês UTC da reserva mudando também exige revisão; nova confirmação correta grava somente no destino mostrado.
- Falha de confirmação do commit, inclusive simulação em que o callback terminou: não restaurar sessão nem liberar a chave. Rollback conhecido antes de commit continua testado separadamente.
- A/B: B não confirma, cancela, restaura ou grava usando rascunho de A; reserva e teto sempre no escopo do dono. Regressões completas do 3b1.

Rodar testes dos três módulos, suíte completa e build do backend. Datas em UTC, America/Sao_Paulo e Asia/Tokyo. Lint com a configuração existente; se ausente, configuração temporária fora do repo e comparação com a dívida de `any` já documentada. A integração real e os mutantes do revisor não substituem esses testes.

## 6. Caminhos autorizados

- `backend/src/conversation/conversation.{module,service,types}.ts` e specs já existentes; `replies.ts`; `parsers/intent.matcher.{ts,spec.ts}`; novo `parsers/envelope.parser.{ts,spec.ts}` somente se separar o parsing realmente ajudar.
- `backend/src/envelopes/envelopes.service.{ts,spec.ts}` e novo `conversation-write.types.ts` com tipos/erros internos, se necessário.
- `backend/src/credit-cycle/credit-cycle.service.{ts,spec.ts}` e novo `conversation-write.types.ts` com tipos/erros internos, se necessário. `credit-cycle.util.ts` só se a correção exigir e mantendo testes das regras atuais.
- Documentos desta pasta, registrando o resultado sem alterar as decisões aprovadas.

Sem controllers, schema/migrations, DTOs HTTP, billing/catálogo, goals, recorrências, parcelados, frontend ou arquivos de ambiente. O principal atualiza handoff e grafo ao final da integração/revisão; não rodar graphify em paralelo com outro agente.

## Entrega do desenvolvimento

Relatar arquivos alterados, comandos e números verdes, decisões técnicas, limites e pontos que a revisão precisa exercitar. Marcar claramente o que foi executado e o que ainda é requisito. Deixar mudanças sem commit para o revisor.
