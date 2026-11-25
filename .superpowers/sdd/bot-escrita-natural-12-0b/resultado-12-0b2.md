# Resultado 12.0b-2: confirmacao com tom e ensino das frases naturais

Branch: feat/bot-escrita-natural-12-0b (worktree Lumen-bot-natural). Data: 2026-11-25. Executor: Claude Haiku 5.5 (sem subagentes).

## O que mudou
- `backend/src/conversation/tone/tone.texts.ts` (novo): textos fixos por tom (ALEGRE, CELEBRANDO, NEUTRO, ATENTO) x momento (rascunho, recibo), 3 variantes cada, e lista de radicais sensiveis.
- `backend/src/conversation/tone/tone.service.ts` (novo, puro): `toneKindFor` (sensivel forca NEUTRO), `hasSensitiveWord`, `variantIndex` (FNV-1a do messageId mod tamanho), `toneText` (troca placeholders; falta de valor lanca erro).
- `replies.ts`: `draftText` abre com a frase de tom e mostra todos os dados; `doneText` vira recibo com tom (receita comemora, despesa so confirma); `contributionDraftText`/`contributionDoneText` (guardar) e `installmentDraftText`/`installmentCreatedText` (parcelado) com tom. Ajuda e textos de erro: "50 mercado" trocado por "gastei 50 no mercado"; ajuda mostra as formas naturais. Marcador 'Responda "confirmar" ou "cancelar".' mantido no rascunho de lancamento e de aporte.
- `conversation.types.ts`: `toneSeed?` em ExpenseOrIncomeDraft, ContributionDraft, InstallmentDraft (messageId que abriu o rascunho).
- `conversation.service.ts`: grava `toneSeed` na abertura (inicio, aporte, parcelado); passa a semente e a categoria (lida por `toDraftView`, so leitura) ao recibo. Sem mudanca de regra de gravacao, matcher ou fluxo de confirmacao.
- `menu/menu.tree.ts`: exemplos "caiu 500 do freela" (receita) e "coloquei 200 na minha caixinha" (guardar).

Escolhas: tom por tipo (contrato secao 3). Apagar/editar continua com texto neutro atual. Sensivel vale para descricao e categoria no rascunho; no recibo, a categoria vem da visao do rascunho (mesma regra).

## Textos finais para revisao
Ver `.superpowers/sdd/bot-escrita-natural-12-0b/textos-de-tom.md` (24 variantes e lista de radicais sensiveis).

## Testes
- Novos: `tone/tone.service.spec.ts`, `replies.tone.spec.ts`, `menu/menu.teaching.spec.ts`; acrescentados testes de semente em `conversation.service.spec.ts` (aporte, parcelado e lancamento: rascunho e recibo com o mesmo messageId).
- Ajustes de expectativa (texto mudou): `conversation.service.spec.ts` (aporte e parcelado), `card-expense.spec.ts`, `menu-action.spec.ts`.
- Correcao de teste intermitente: `isolation.spec.ts` usava `/987/` e `/777/` para detectar vazamento de valor; o `draftId` e um UUID aleatorio com hex e podia conter esses digitos. Agora casam `987[.,]65` e `777[.,]77`. Causa confirmada por dump do JSON restaurado (draftId UUID presente). Outra causa de falha achada nesta fatia: teste de variante dependia do messageId aleatorio (recibo do parcelado com "total" so em 2 das 3 variantes); variante 3 trocada para "..., total {total}.".

Numeros (data 2026-11-25, conferido pelo agente principal):
- `npx tsc --noEmit`: sem erro.
- Suite inteira `TZ=UTC npx jest --maxWorkers=2`: 103 suites, 3285 testes, todos verdes.
- `src/conversation src/telegram src/whatsapp` em `America/Sao_Paulo`: 2019 verdes. Em `Asia/Tokyo`: 2019 verdes.
- Testes novos e seeds repetidos 15x seguidas: 15/15 verdes (218 passed por rodada, filtro por nome).
- `graphify update .`: ok (AST).

## Mutantes (38 no total: 33 da lista inicial + 3 de semente de servico + 2 de recibo de aporte/parcelado)
- MORTOS: 37 ao fim. Pelo menos 1 teste mata cada um. Lista por area: tom por assunto (4), sensivel (2), variante deterministica (2), placeholder (2), emoji (2), exclamacao (1), radical (1), texto do rascunho sem pergunta/valor (2), semente ignorada no rascunho e recibo (2), categoria sensivel ignorada (2), linha de tom do parcelado (1), frase de meta concluida (1), meta sensivel (1), ensino curto na ajuda e no erro (2), exemplos do menu (2), semente do servico (3 + 2).
- SOBREVIVENTES na primeira rodada: semente do servico (rascunho de aporte/parcelado e recibo de aporte/parcelado) e o menu com exemplo antigo. Cada um virou teste (mensagem com 6 ids fixos e comparacao com a variante esperada; exemplos exatos do menu). Matados depois.
- EQUIVALENTES: nenhum identificado.
- Aplicacao: cada mutante altera um texto no codigo, roda os specs alvo e restaura o arquivo; o arquivo foi restaurado (conferido pelo git status).

## NAO verificado
- Percepcao do tom pelo dono (gosto do texto): depende da revisao de textos-de-tom.md.
- Integracao real (Docker, Telegram, WhatsApp, banco): fora desta fatia (sem Docker). Telegram e WhatsApp so pelos testes unitarios de formatador existentes, que passam.
- Mensagens de boas-vindas dos adaptadores (telegram/whatsapp: "linked", "empty") e o texto do receipt-extractor ainda citam "50 mercado". Fora do escopo listado; ver duvidas.md.
- Recibo por categoria sensivel via servico (categoria vinda de toDraftView): so coberto pelos testes unitarios de doneText, nao por teste de servico.
- Isolamento (isolation.spec.ts) nao rodou 15x apos a correcao: rodado 12x isolado sem falha antes da correcao e sem falha depois, mas a falha original era rara e so apareceu sob carga na suite completa.
- Variantes com numero por extenso, "2k", "conto(s)": fora do escopo (contrato secao 6).
