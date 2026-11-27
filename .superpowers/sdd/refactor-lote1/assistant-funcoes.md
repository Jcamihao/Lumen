# Revisao refactor lote 1: assistant (selah-payload, spending-analysis, local-reply)

Data: 2026-11-27. Conferido por: Claude Sonnet 5.5 (revisao + mutantes).
Commits revisados: 5d47c75 (caracterizacao), 97eb2d1 (payload), 0f337b6 (spending), 86ee1a9 (local-reply).

## Conferencia linha a linha (original 5d47c75~1 x novo)
- Payload Selah: mesma ordem de chaves (message ... notificationLabels), mesmos nomes, mesmos top-N (tarefas 5, transacoes 5, metas 4, insights 5, lembretes 4, notificacoes 4), mesma sanitizacao. Nenhum campo novo (sem e-mail/id).
- Spending: mesma janela (dia 1, mes atual-2, getters UTC), mesmo fuso padrao (America/Sao_Paulo), mesma query (userId, gte, 3 tipos), sinal (so INCOME positivo), media /3, CV <= 0.2 fixo, empate fica com a primeira. Ordem da checagem tipo/indice trocou, sem efeito.
- Resposta local: textos, emoji/moeda, top 3 tarefas/2 metas, ordem das secoes e das chaves identicos.
- Consumidores: selah.client.ts, assistant.service.ts (assinaturas inalteradas). Sem defeito de DI.
- Tamanho: todos os arquivos novos <= 56 linhas, funcoes <= 20 linhas. Sem duplicacao relevante (local-context e spending-window centralizam constantes).

## Achados
1. Normalizacao do spec do selah mascarava dia/mes junto com a hora (`dd/mm, hh:mm`). Corrigido: mascara so a hora; snapshot e teste do rotulo passam a exigir `20/11`. Nao esconde mais diferenca real.
2. Snapshot de caracterizacao do selah passa por JSON.parse e ordena chaves: ordem nao era testada. Novo spec compara Object.keys.
3. Caso "Quais as prioridades?" nao contem "prioriz": nunca exercitava a resposta de prioridades. Novo spec usa "prioriza".
4. Query do Prisma e mockada: userId/tipos/gte nao eram verificados. Novo spec confere.

## Mutantes (56 no total)
- 1a rodada: 40 mortos, 16 sobreviventes. Apos novos testes: 15 mortos; 1 equivalente.
- Cobertos: top-N de cada lista (5/4/3 e +1/-1), sinal do saldo, janela (mes -2 vs -3, >= / >, <=), fuso padrao, gte->gt, remover tipo TRANSFER, remover userId, sinal de INCOME, divisor 3->2, limiar CV (0.2->0.3), empate (> vs >=), mean<=0, texto/emoji/palavra (puxaria, concluida, hoje., risco:, em/ate, ":" vs "-"), risco padrao, ?? 0, moeda, ordem de campos (originModule, grupos), ordem de secoes (destaques), remover monthlyExpenses, trocar slice de tarefas/metas locais, confidence/provider/continuity/confidenceReason.
- Campos sensiveis adicionados (email em user, id em transacao e tarefa, email na resposta local): mortos (spec de contrato com extras no resumo; email local morre por erro de tipo).
- Sem sanitizacao em categoria e titulo de meta: mortos pelo spec de contrato.
- Equivalente: `coefficientOfVariation <= 0.2` -> `< 0.2`. Igualdade exata exige raiz quadrada de float igual a 0.2: inalcancavel com valores monetarios (norma 0.06*m^2 nao e representavel em inteiros).
- Todos os arquivos revertidos; git status limpo.

## Testes novos (commit 9eb680e)
- selah/selah-payload-contract.spec.ts, spending/spending-query.spec.ts, reply/local-reply-limits.spec.ts (todos <= 120 linhas).

## Verde (2026-11-27, Claude Sonnet 5.5)
- `npx jest src/assistant`: 88 testes, 36 snapshots, em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- 15 execucoes seguidas em UTC: 15x 88 passed.
- `npx tsc --noEmit | head -5`: vazio.

## NAO verificado
- Integracao real com banco/Selah externo (so mocks).
- formatDate/formatDateTime/sanitizeExternalText (fora do escopo; apenas usados).
- Mutantes de TZ do servidor diferente de UTC na janela de gastos alem do caso de 01/11 02:00Z ja no spec.
