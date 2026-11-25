# Resultado - bot perguntas naturais (feat/bot-perguntas-naturais)

## Mudancas
- backend/src/conversation/parsers/read-question.ts (novo): matchReadQuestion(raw, tokens, words). Tira enchimento, compara nucleo exato. Card: "como/qual" + cabecalho (fatura, limite, cartao, devo) + nome.
- backend/src/conversation/parsers/intent.matcher.ts: chama matchReadQuestion so no fim (depois de todos os matchers atuais). Mudanca em matchCardRead: loose nao aceita nome que seja palavra de leitura (hasReadVocabulary). CARD_LOOSE_MAX_WORDS movido para read-question.ts.
- backend/src/conversation/parsers/intent.matcher.read-question.spec.ts (novo): ~520 testes (positivos x3 variantes, negativos, regressao, propriedade ? / sem ?, limite de palavras, digitos).

## Commits (branch feat/bot-perguntas-naturais)
- 27e1c42 feat(conversation): entende perguntas naturais de leitura
- 12a4222 test(conversation): tabela de perguntas naturais, negativos e mutantes

## Numeros
- npx tsc --noEmit: exit 0 (2026-11-25)
- jest src/conversation src/telegram src/whatsapp --maxWorkers=2: 37 suites, 1658 testes verdes em TZ=UTC, America/Sao_Paulo, Asia/Tokyo
- jest (suite inteira, --maxWorkers=2, TZ=UTC): 95 suites, 2924 testes verdes
- graphify update . : ok (6701 nodes, 14776 edges)

## Mutantes (18 injetados em read-question.ts e intent.matcher.ts)
Mortos (18): M1 sem filler "o"; M2 aceita palavra desconhecida; M3 troca intent de metas; M4 ignora valor numerico; M5 sem limite de 12 palavras; M6 sem regra de "?" no cartao; M7 limite de nome 99; M8 explicito nunca; M9 sem checar vocabulario do nome; M10 sem conector na fatura; M11 "hoje" nao e enchimento; M12 "mes" some de month; M13 sem preposicao pendurada; M14 sem checar lead do cartao; M15 "quanto" vira opener de "?"; M16 sem remover pontuacao do nome; M17 "tenho" some do saldo; M18 matcher antigo sem checar vocabulario.
Sobreviventes: 0 (M5 sobreviveu na 1a rodada por bug do proprio teste, corrigido).
Equivalentes: nenhum identificado.

## Desvios do brief (registrados)
- "quanto sobrou no Nubank?" ja era null por teste existente; mantido (ver duvidas.md item 2).
- "quanto devo no Nubank?" com "?" fica null (item 3 das duvidas).
- Varias frases "quanto tenho ..." caem em saldo pelo prefixo antigo (duvidas.md item 1). Nao mudei.

## NAO verificado
- Lint/prettier nao rodado.
- Sem Docker / integracao real: fora do escopo do brief.
- Bot real (Telegram/WhatsApp) nao testado ponta a ponta; so matcher.
- Comportamento do servico para cardTerm loose com nome que nao existe nao foi revisto (fluxo existente).
- Suite inteira so em TZ=UTC (exigido 3 TZ so para conversation/telegram/whatsapp).
- .superpowers/sdd/bot-perguntas-naturais/ fica sem commit (pasta nao rastreada; decisao do dono se versiona).

## Pendente
- Dono decide duvidas.md itens 1-5.
- Handoff nao atualizado (sem merge em develop).
