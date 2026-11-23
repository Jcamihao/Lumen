# Resultado 8b-1 — editar/apagar metas e reservas por conversa (backend)

Contrato: `docs/superpowers/specs/2026-11-23-conversa-contrato-item-8b.md` (aprovado 2026-11-23). Feito pelo Qwen na própria sessão (regra do dono: sem Anthropic, sem subagentes).

## O que entrou

- **Matcher**: verbo de mudança + substantivo escolhe o alvo — `meta|metas|cofrinho` → GOAL, `reserva|reservas|envelope` → ENVELOPE, sem substantivo continua lançamento (8a). Artigos/poses (`a minha`) não entram no termo. Mesmas travas do 8a (≤6 palavras, sem `?`).
- **Rascunhos novos**: `GOAL_CHANGE` / `ENVELOPE_CHANGE` com a mesma forma do 8a (ação, candidatos, `targetId`, `targetUpdatedAt`, mudanças, idempotência, restauração).
- **Busca**: metas de qualquer status, sem janela de data; reservas por nome; termo sem acento/caixa em memória; teto de 5; mais recentes primeiro.
- **Editar (campos aprovados)**: meta — título, valor alvo (inclui `sem alvo`), prazo (`20/12`, `20/12/2026` ou `12/2026` = último dia do mês; `sem prazo`); reserva — nome e valor mensal (aviso "vale a partir do próximo depósito"). Uma mudança por mensagem, prévia "antes → depois".
- **Apagar**: prévia com o alvo inteiro + aviso do que acontece (aportes ficam soltos / depósitos somem, gastos ficam), só a palavra `apagar` ou a flag `delete:true` do cartão (mesmo DTO rígido do 8a-2; `isDeleteChange` estendido).
- **Aplicação**: releitura `id + userId`, checagem de `updatedAt` nos dois caminhos (herança do ajuste do 8a), gravação pelos **mesmos serviços da tela** (`GoalsService.remove/update`, `EnvelopesService.remove/update`) — semântica da tela exata, incluindo entitlement/duplicidade por conta do serviço.
- **Cartão**: `toDraftView` com `changeAction`, título ("Apagar meta" etc.) e linhas (inclui linha de Aviso); RESTORED funciona sem mudança de frontend para os botões.

## Mutantes (injetados um por vez, revertidos entre injeções) — 9, todos mortos

| # | Mutante | Morto por |
|---|---|---|
| M1 | substantivo `meta` nunca roteia | lista/fluxo de metas (19 falhas) |
| M2 | `isDeleteChange` ignora kinds do 8b | recusa-do-confirmar em meta |
| M3 | aplicação sem checagem de `updatedAt` | conflito apagar + editar |
| M4 | leitura do alvo sem `userId` | teste novo de rascunho adulterado (sobreviveu de primeira; fechei com teste) |
| M5 | busca sem teto de 5 | teste do teto |
| M6 | prazo mm/aaaa virando dia 1 | teste do prazo (31/12) |
| M7 | confirmar-sem-mudança só valia p/ lançamento | teste "nada para mudar" |
| M8 | diff mostrando campo igual ao atual | teste de mudança igual |
| (M4 re-caçado após o teste novo) | | |

## Arquivos

- Novos: `target-change.ts` (puras), `target-change.spec.ts` (27), `parsers/intent.matcher.target-change.spec.ts` (5).
- Tocados: `intent.matcher.ts`, `conversation.types.ts` (kinds/pending `target`/draft), `transaction-change.ts` (`isDeleteChange`), `conversation.service.ts` (fluxo: start/search/load/list/answer/text/rows/apply/discardText/routing).

## Verificação (2026-11-23, worktree Lumen-item8a2)

- `tsc --noEmit` limpo; `nest build` ok.
- Jest inteiro: 75 suítes, **2003 testes** verdes.
- `src/conversation`: **747** verdes em UTC, America/Sao_Paulo e Asia/Tokyo.
- `target-change` 15 execuções seguidas: 27 verdes em todas.
- Frontend não foi tocado (a 8b-2 cuida de rótulos/karma).

## NÃO verificado

- Integração real em Postgres/Redis descartáveis (pretendo rodar no fechamento da 8b junto com E2E do cartão — anotar no handoff se mergear antes).
- Concorrência real do `updatedAt` (bloqueio Prisma só existe no update da tela; o apagar usa remove simples — mesma race aceitado no 8a).
- Comportamento de entitlement ao editar reserva pausada que reativa (fora do escopo aprovado — não mexemos em `isActive`).
