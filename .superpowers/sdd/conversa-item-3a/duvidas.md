# Dúvidas e decisões do dev (item 3a)

Itens onde o contrato era omisso ou pedia algo que não bate com o modelo de dados. Implementei a opção abaixo; o agente principal confirma ou manda trocar.

## 1. Valor da última parcela (installments e upcoming_dues)

- Contrato (secao 4 e 3): "valor da parcela" = `installmentAmount`.
- Problema: o materializador (`installment-materializer.service.ts`, linha 64) faz a última parcela valer `totalAmount - installmentAmount * (total - 1)`. Ou seja, a última parcela tem valor diferente de `installmentAmount` quando há sobra de arredondamento.
- Decisão implementada: quando `remainingInstallments === 1`, o valor exibido é `remainingAmount` (que é exatamente o valor da última parcela). Nas demais, `installmentAmount`.
- Confirmar: está certo? Se o contrato quiser `installmentAmount` sempre, trocar a função `installmentCents` em `conversation.service.ts`.

## 2. Meta com alvo zero ou negativo

- Contrato não cobre. Alvo `<= 0` divide por zero no percentual.
- Decisão: trata como cofrinho (sem alvo). Texto "R$ X guardados (sem alvo)".

## 3. Rótulo de meta

- Contrato diz `label`. O modelo `Goal` tem `title` (sem campo `name`). Uso `title`.

## 4. Corte de 60 caracteres

- Contrato: "truncar com '…'" em 60 caracteres. Implementado como total de 60 (59 + "…"), contando code points.

## 5. Dados de `ReplyData` (dues, installments, fixedBills, goals)

- Listas no `data` trazem as mesmas linhas do texto (limitadas: 5, ou 8 em vencimentos). Os totais (`totalCents`) são sobre todos os itens. Contrato não diz se `data` deve ser completo ou limitado.

## 6. Falha de leitura e ponto único

- Não havia ponto único de leitura: o `recordEvent` ficava em cada chamador. Criei `runRead` (um só try/catch) que chama `answerRead`, grava o evento (`RECOGNIZED` ou `ERROR`, sem texto) e devolve a resposta. Os dois chamadores de leitura usam esse método.
- Se gravar o próprio evento falhar, a exceção ainda sobe (500). Contrato não cobre falha no registro de evento.

## 7. Aviso de metas fora da lista quando não há ativa

- Contrato não diz se o aviso aparece quando não há meta ativa. Implementei: aparecem as duas linhas ("Você ainda não tem metas ativas." e o aviso de N meta(s)).

## 8. "Hoje" da janela

- Usa `receivedAt` da mensagem (mesmo relógio do rascunho), no fuso do usuário. Não usa `new Date()` como `spendByCategory`.

## Revisão (sonnet): decisões e correções

9. **Matcher mais estreito (desvio consciente do contrato, que diz "começar por a frase").** Qualquer texto depois de `metas ` etc. virava consulta e sequestrava perguntas ao Selah ("minhas metas estão boas?", "parcelas do carro: vale a pena?"). Regra nova só para as 4 consultas novas: a frase sozinha (com ou sem `?`) sempre casa; com palavras depois, casa só se forem no máximo 3 e a mensagem não tiver `?`. As intenções antigas (`saldo`, `resumo`...) não mudaram. Custo conhecido: "o que vence essa semana?" (com `?` e complemento) vai ao Selah. Dono pode afrouxar mudando `FINANCE_READ_MAX_EXTRA_WORDS` ou a regra do `?`.
10. **Texto da meta com alvo** passou a seguir o contrato: "R$ guardados de R$ alvo (X%), falta R$ Y". O dev tinha escrito "X% guardado de alvo (R$ ... de R$ ...)".
11. **Total mensal estimado** agora soma em doze avos de centavo (inteiros) e divide por 12 uma vez. Antes somava reais em float e multiplicava por 100: uma conta anual de R$ 0,42 dava 3 centavos em vez de 4.
12. **Logger** no `ConversationService`: falha de leitura grava `Leitura falhou: intent=<id> erro=<error.name>`. Nunca `error.message`, texto da mensagem, saldo ou descrição.
13. Se gravar o evento `ERROR` também falhar (banco fora), a exceção sobe (500). Mantido: sem banco não há o que responder de forma útil.
