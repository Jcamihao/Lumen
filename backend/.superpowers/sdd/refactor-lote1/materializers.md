# Revisao: refatoracao dos materializers (lote 1)

Data: 2026-11-27. Revisor: Claude Sonnet 5.5. Worktree: wt-refactor-lote1/backend.
Base: HEAD~2 (original) vs HEAD. Comparacao linha a linha feita.

## Equivalencia com o original
Sem mudanca de comportamento encontrada. Conferido:
- Consultas Prisma identicas (findMany candidatas, user.findUnique so timezone, updateMany, transaction.create).
- Mesma transacao: claim + create dentro; fallback P2002 fora, com updateMany condicionado.
- updateMany com where { id, nextDueDate: due, isActive: true } nos dois servicos.
- P2002: count 1 vira 'existed' (avanca, nao conta); count 0 vira 'lost' (para).
- MAX_CATCH_UP_PER_RUN = 24, re-exportado em recurring-materializer.service.ts. Teto, due <= today, parcela <= total: mesma logica (so mudou a ordem de termos puros).
- Dia 31 (anchorDay), data final (> no expirado, > no finished), ultima parcela (isActive false, nextDueDate null, sobra no valor), lastGeneratedAt = now, contagem retornada, log.
- closeExpired antes de calcular next, como no original.
- DI/consumidores: transactions.service, life-workers.service, installments.service, recurring-transactions.service e modulos usam as mesmas classes e paths. Nada mudou.
- Specs antigos importam MAX_CATCH_UP_PER_RUN pelo re-export: ok.

## Estrutura
- Arquivos todos <= 120 linhas (maior: 59). Duplicacao entre installment/recurring: so claim e candidates, parecidos por tipo de modelo; aceitavel.
- Acoplamento: common/materialization/due-window.ts importa recurring-transactions/recurrence.util (common depende de modulo de dominio, dependencia invertida). Recomendo mover recurrence.util para common/utils em refatoracao propria (toca varios consumidores, fora do escopo).
- recurring-occurrence.ts importa '../../recurring-transactions/recurrence.util'; o caminho certo e '../recurrence.util' (cosmetico).
- Funcoes > 20 linhas: materializePlan (~25) e materializeTemplate (~35). Violam o limite do dono, sem risco de comportamento. Dividir o corpo do laco e opcional.

## Mutantes (46 rodados, jest completo de installments + recurring-transactions + common)
Mortos pelos testes existentes (40): M1-M4 (claim sem nextDueDate/isActive, inst e rec), M5, M5c, M5d (P2002), M6 (existed conta como created), M7 (teto literal 25), M8 (teto <=), M10 (due < today), M11 e M12 (dia 31), M13 e M14 (endDate), M15 (finished sempre false), M16 e M17 (nextDueDate nao avanca), M18 (ultima sem isActive false), M19 (contador), M20, M21, M42 (valor/ultima parcela), M22 (fuso ignorado), M24 (lookahead 0), M26, M27 (contagem), M28 (insert fora da tx), M30, M31 (lost nao para), M33, M34, M36-M41 (filtros e fechamento expirado).
Sobreviventes (6), mortos pelos testes novos (materialization-contract.spec.ts, 92 linhas, commit 7118f0b):
- M5b fallback P2002 com count >= 0 (lost virava existed e seguia o laco).
- M9 constante do teto 25 (testes antigos usavam a propria constante).
- M23 fuso padrao Asia/Tokyo em vez de UTC.
- M25 lookahead 2 dias.
- M29 claim pelo cliente de fora em vez da tx (perde atomicidade).
- M35 (= "M6 ignorar finished" do implementador): nao parar em finished.
Equivalente (1): M32, nao parar apos next === null na ultima parcela; o laco ja termina por installmentNumber <= installmentsTotal.
M6 do implementador (ignorar finished) e equivalente so no estado do banco: o closeExpired extra faz updateMany que acha 0 linhas (o claim ja pos isActive false). Difere na escrita extra. O teste novo mata isso (claim so na tx, sem updateMany de fora).
Notas: a 1a rodada de M27 deu falso kill (erro de compilacao TS); refeita com outro corpo e morta de verdade. M13 e M16 tiveram ancora errada na 1a vez; refeitos.
Arvore restaurada de /tmp/claude-1000/scratch-mat2 apos cada mutante; git status limpo.

## Defeitos reais
Nenhum no codigo de producao.

## Verde (2026-11-27, conferido por Claude Sonnet 5.5)
- npx jest src/installments src/recurring-transactions src/common: 14 suites, 213 testes.
- TZ=UTC, America/Sao_Paulo, Asia/Tokyo: 213/213 em cada.
- 15 execucoes seguidas em UTC: 15 x 213/213.
- npx tsc --noEmit filtrado em src/(installments|recurring|common): vazio.

## NAO verificado
- Concorrencia real e unicidade (P2002) em Postgres: tudo contra Prisma falso. Nao rodei integracao em contêiner.
- Atomicidade da transacao (M28, M29) so e provada por mocks distintos de tx e cliente.
- Queda no meio do commit: nao injetada.
- Suite completa do backend fora dos 3 diretorios: nao rodada.
- Mutantes de tipo (TS) podem matar por compilacao; so M27 foi notado e refeito.
