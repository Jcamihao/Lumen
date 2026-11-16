# Dúvidas, decisões e mudanças de comportamento: item 3b2b (backend)

Data: 2026-11-16. Autor: subagente de desenvolvimento do backend (haiku). Nenhum commit, push, deploy, migration ou alteração de frontend.

## 1. Mudanças de comportamento na tela (precisam de aceite do principal)

A. **Conta fixa e parcelado, `POST` da tela:** falha de materialização ou de atualização dos dados derivados depois do cadastro não vira 500. O cadastro responde 201 com o item (mesma decisão do 3b2a para reserva e limite). Antes: 500 com o registro já gravado, e o usuário tentava de novo e duplicava. Só o nome do erro vai para log.

B. **Conta fixa, `POST` da tela:** descrição é aparada e validada no domínio (2 a 120 caracteres). Antes o DTO validava o texto sem aparar, então `"  a  "` passava e virava 1 caractere. Agora responde 400. Valor e frequência também são conferidos no núcleo (o bot chama o núcleo sem o ValidationPipe).

C. **Parcelado, `POST` da tela:** regra nova de parcela mínima. Dividir R$ 1,00 em 60 vezes (ou total que deixe a última parcela zero/negativa) responde 400. Antes gravava parcela de R$ 0,02 e última negativa. O contrato 3b2 (seção 5) pede a regra também na tela.

D. **Parcelado, divisão:** agora em centavos inteiros (`Math.round(total/n)`, última = sobra). Resultado igual ao `Math.round(total/n*100)/100` anterior nos casos testados (100 em 3 = 33,33 + 33,34; 1200 em 12 = 100,00 cada).

E. **Gravação com `$transaction`:** conta fixa e parcelado agora criam o registro dentro de `$transaction` (uma única escrita). É o que permite distinguir rollback conhecido de commit desconhecido. Resposta HTTP inalterada (teste de formato existente passa).

## 2. Decisões onde o contrato era omisso

1. **Texto do aviso de pós-gravação.** Materialização falha: "Cadastro salvo. A atualização dos lançamentos está pendente; confira a tela de Finanças." (contrato). Atualização de dados falha: "Cadastro salvo. A atualização dos dados está pendente; confira a tela de Finanças." (mesma escolha do 3b2a). Se as duas falharem, vale o de lançamentos.

2. **Sufixo de frequência é a última palavra.** `criar conta fixa 120 seguro anual` vira frequência anual com descrição "seguro". A gramática manda tratar a frequência como sufixo delimitado. Se o dono quiser que "anual" no fim da descrição seja texto, é uma regra a mudar.

3. **Valor fora do início não é extraído.** `criar parcelado geladeira 1200 em 12x` deixa "geladeira 1200" como descrição e pergunta o total. A gramática fixa o total no início. Não tentei adivinhar número no meio do texto.

4. **`12x de 100`** é recusado na abertura com a orientação de informar o total (mensagem própria). Em resposta a campo de total, cai no erro de valor com "Responda só o valor".

5. **Data passada.** Na abertura: recusa sem rascunho com a orientação de cadastrar o histórico pela tela. Em resposta a campo de data: pergunta de novo com o motivo e mantém o rascunho. Data que não é hoje, dd/mm ou dd/mm/aaaa (amanhã, dia 5, ISO, duas datas): pede data completa; na abertura, o campo fica pendente.

6. **Data acima de dois anos.** O motor recusa antes de abrir rascunho usando `firstDueLatestYmd` (função do próprio domínio de conta fixa, a mesma regra do núcleo). O núcleo também confere na gravação.

7. **Condição revisável de vencimento.** Confirmação com vencimento que ficou no passado: nenhuma gravação, `version + 1`, `firstDueDate` volta a null, `pendingField: 'firstDueDate'`, estado COLLECTING com 15 minutos e linha "Atenção". Para isso `reviseDraft` escolhe o estado pelo campo pendente e `restoreSession` passou a manter o estado da sessão (e o prazo daquele estado). Falha comum continua restaurando como AWAITING com 5 minutos, como antes.

8. **Quantidade "doze" ou "1,5":** pede de novo sem prefixo (ou com "A quantidade de parcelas vai de 2 a 60." para número fora da faixa).

9. **Divisão que não fecha** (R$ 1,00 em 60 vezes, ou total baixo na resposta de total): o motor recusa na abertura, ou pergunta de novo com "Com essa quantidade, uma parcela ficaria abaixo de R$ 0,01...", sem guardar a resposta. Assim o rascunho não chega à confirmação só para ser descartado.

10. **Avisos do cartão.** Vencimento hoje: "Ao confirmar, será gerado o lançamento de hoje." (conta fixa) ou "...a parcela de hoje." (parcelado). Vencimento futuro: "Os lançamentos serão gerados nos vencimentos.". Sempre: "Outros cadastros já vencidos também podem ser atualizados junto, como na tela." (texto meu, para cumprir a instrução do brief; o dono pode trocar em `REPLIES.catchUpWarning`).

11. **Frequência no cartão** em maiúscula inicial (Mensal, Semanal, Anual). Na resposta de confirmação, em minúscula (mensal, semanal, anual), como na tela de contas fixas.

12. **Descrição** usa `.length` (como o DTO), não contagem por code point. Diferença só para emoji.

13. **Conectores** no início da descrição (de, na, com...) são tirados, como nos lançamentos. "de internet" vira "internet".

## 3. Achado fora do escopo (para o principal)

- `backend/src/credit-cycle/credit-cycle.service.ts` usa `FOR NO KEY UPDATE`, mas o relatório da revisão do 3b2a (resultado-revisao.md, item Baixo) fala em `FOR UPDATE` e diz que não foi trocado. O código atual está com `NO KEY UPDATE`. Não toquei. Confirmar qual é o estado aprovado antes do commit.

## 4. Não verificado nesta execução

- Postgres real e Chrome: nada de banco real pelo brief. Os testes são unitários com mocks (fake DB no spec do motor e mock do Prisma nos specs de domínio). Falha de commit real, concorrência real e integração API + tela não foram exercidos.
- Frontend: fora do escopo deste subagente. Não rodei `ng test`.
- Lint: o backend não tem ESLint configurado (dívida já registrada). Nada novo criado.
- Grafo: `graphify update .` fica com o agente principal.

## 5. Falha intermitente não identificada

Uma vez, logo depois da restauração dos mutantes e da captura dos JSONs, a suíte do motor (`conversation.service.spec.ts`) falhou com 1 teste (606 de 607 nos três módulos). Não consegui identificar o teste, porque a saída daquela rodada não foi guardada. Depois disso: 3 reexecuções dos três módulos (607 verdes cada), 6 reexecuções do motor (242 verdes cada) e a suíte completa (47 suites, 1162 testes verdes). Confirmar se reaparece; se reaparecer, guardar o log inteiro.
