# Duvidas e decisoes da 9a-1 (cartoes nomeados, backend)

Data: 2026-11-23. Implementador: agente haiku (sem revisao ainda).

## 1. Chave do teto no insights (brief item 5 x spec 4.8 x compilacao)
- Conflito: o brief diz "nao mudar insights" na 9a-1, mas o teto deixa de existir
  como userId_closingDate (agora cardId_closingDate, spec secao 2). Sem trocar a chave,
  insights.service.ts nao compila.
- Decisao tomada: troca mecanica so da chave do teto. insights.service.ts busca o
  cartao padrao ativo e le o teto dele (spec 4.8: detectCreditCycle olha o padrao na 9a).
  O agregado de gasto NAO mudou (continua pelo paymentMethod CREDIT e countAllPayments
  do User). Como nenhum lancamento recebe cardId na 9a-1, o resultado e igual ao de hoje.
- Para o revisor: se preferir, a alternativa e outra trava; mas ela nao cumpre 4.8.

## 2. Indices unicos parciais nao sao modelados pelo Prisma
- Nome unico sem caixa entre ativos e um padrao ativo por usuario ficam so na SQL
  (CreditCard_userId_lower_name_active_key e CreditCard_userId_default_active_key).
- Consequencia: `prisma migrate dev` / `migrate diff` vao propor DROP desses indices.
  Nao rode migrate dev sem revisar. Comentario no schema.prisma avisa.

## 3. prisma/seed.js (fora do brief)
- O seed cria usuario direto com prisma.user.create. Sem cartao padrao, o ciclo do usuario
  demo daria 500 (invariante). Criei o "Principal" no seed. Anotado.

## 4. Formato do PUT /credit-cards/:id/ceiling
- O brief nao fixou o corpo. Decisao: devolve recibo (cardId + CreditLimitWriteReceipt:
  id, ceilingCents, cycleStart, cycleEnd, refreshPending), porque a regra de escrita manda
  recibo. /credit-cycle/ceiling continua devolvendo getCurrent (compatibilidade, spec 4.2).

## 5. Sincronia User <-> cartao padrao sem CHECK
- Espelho so por codigo (mesma transacao). Sem trigger nem CHECK. A migration nao põe
  CHECK de 1..31 porque dado antigo fora da faixa abortaria a migration; a validacao fica no DTO.

## 6. Lacuna de teste: concorrencia do teto
- O teto usa o lock do User (mutante M16 morto por teste de lock), mas nao ha teste de
  concorrencia de teto contra promocao de padrao. Pendente para o revisor.

## 7. HEAD destacado durante a sessao
- O reflog mostra "checkout: moving from feat/varios-cartoes to HEAD" as 08:25:50, antes do
  primeiro commit desta etapa. Nao foi um comando meu. Os 4 commits ficaram no HEAD destacado;
  reatachei a branch com update-ref (avanco de 687c63a a partir de d59d83e, sem reset).
  Causa desconhecida: vale checar se outro processo esta usando o mesmo repositorio.

## 8. Conversation
- src/conversation nao foi alterado. Os specs do conversation passam sem ajuste; isolation.fixture.ts intocado.
