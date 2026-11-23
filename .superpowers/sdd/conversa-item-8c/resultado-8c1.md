# Resultado 8c-1 — editar/apagar contas fixas e parcelados por conversa (backend)

Contrato: `docs/superpowers/specs/2026-11-23-conversa-contrato-item-8c.md` (aprovado 2026-11-23, D1–D5 = sim). Feito pelo Qwen na própria sessão (regra do dono: sem Anthropic, sem subagentes).

## O que entrou

- **Matcher**: verbo de mudança + substantivo escolhe o alvo — `conta fixa(s)|fixa(s)` → conta fixa; `parcela(s)|parcelado(s)|compra(s) parcelada(s)` → parcelado. D1 respeitado: `conta` sozinha continua lançamento (teste do 8a preservado; um teste do 8a usava a frase literal "apagar conta fixa" e passou a usar "apagar mercado conta", mesma cobertura).
- **Rascunhos**: `RECURRING_CHANGE`/`INSTALLMENT_CHANGE` na MESMA máquina dos 8a/8b (`TargetChangeDraft` com kind 4 vias; `isTargetChangeDraft`/`isEditWithoutChanges`/RESTORED/idempotência herdados; `isDeleteChange` estendido).
- **Busca**: contas fixas de qualquer status (pausada inclusa); parcelados só os que ainda têm parcela a gerar (pausado/concluído ficam fora — apagar isso no chat não tem efeito). Termo sem acento/caixa em memória, teto de 5, mais recentes primeiro.
- **Editar conta fixa (D2)**: descrição (`nome`/`descrição`), valor, data final (`prazo`/`data final`, com `sem prazo` para limpar). Uma mudança por mensagem, prévia antes→depois, `UpdateRecurringTransactionDto` sem `isActive` (não pausamos nem retomamos — D5). Frequência/dia fora (o serviço proíbe).
- **Parcelado**: só apagar (D3) — `editar parcelado X` recebe recusa curta, sem sessão.
- **Apagar (D4)**: prévia com o alvo inteiro + Aviso da semântica da tela (gerados ficam soltos; o que vem somem), palavra `apagar` ou flag `delete:true`, conflito de `updatedAt` nos dois caminhos, gravação pelos MESMOS serviços da tela (`RecurringTransactionsService.update/remove`, `InstallmentsService.remove`).

## Mutantes — 8, todos mortos (rodada limpa, base verde antes/depois de cada um)

| # | Mutante | Morto por |
|---|---|---|
| M1 | `conta fixa` não roteia | lista/matcher (13 falhas) |
| M2 | recusa de editar parcelado removida | teste do D3 |
| M3 | lista de parcelado sem filtro "ainda gera" | teste do filtro |
| M4 | leitura da conta fixa sem `userId` | rascunho adulterado com id de B |
| M5 | parser não come o `final` de "data final" | teste da data final |
| M6 | linhas mostram mudança igual à atual | teste "nada para mudar" |
| M7 | `isDeleteChange` sem `RECURRING_CHANGE` | confirm-sem-flag (5 falhas) |
| M8 | update não aplica data final | teste da data final no banco fake |

**Incidentes da caçada (registrados)**: na primeira rodada o laço quebrou no meio e deixou **M3 aplicado sem revert** (a string `where: { userId },` repetida fez o revert falhar) — dois rodízios de resultado confiaram em base suja; recuperei o original, refiz com contexto desambiguado, checagem de base verde + pós-revert verde em cada mutante. Nada disso vazou: a árvore final foi reconferida (`tsc`, suíte inteira, 15×20).

## Arquivos

- Novos: `recurring-change.ts` (puras), `recurring-change.spec.ts` (14), `parsers/intent.matcher.recurring-change.spec.ts` (6).
- Tocados: `intent.matcher.ts`, `conversation.types.ts` (kinds/changes), `transaction-change.ts` (`isDeleteChange`), `target-change.ts` (union `TargetCandidate`, `isTargetChangeDraft`), `conversation.service.ts` (fluxo estendido: busca/carga/lista/prévia/linhas/aplicação/recusas/textos), `transaction-change.spec.ts` (1 frase, mesma cobertura).

## Verificação (2026-11-23, worktree Lumen-item8a2)

- `tsc` limpo; `nest build` ok. Backend inteiro: **77 suítes / 2023 verdes**. Motor: **767** em UTC/America/Sao_Paulo/Asia/Tokyo. `recurring-change`+matcher: **20 verdes em 15 execuções**.
- **Integração real**: o Docker Desktop do host (WSL2) CAIU no meio do serviço, sem como religar daqui — subi os descartáveis **sem Docker**: Postgres 18.6 e Redis 7 extraídos de pacotes Ubuntu (`apt-get download` + `dpkg -x`, portas 5545/6391, datadir dedicado; o 5433 legado intocado). Migrações aplicadas, app real no :3211. Roteiro `integracao-8c1.mjs` (mesma pasta): **26 checagens, duas corridas, 0 falhas**. Cobre: lista sem vazar B com pausada inclusa, prévia antes→depois real, valor e data final gravados no banco, conflito de `updatedAt` com a tela mexendo no meio, RESTORED com Aviso, flag `delete` e recusa sem flag, apagar parcelado, recusa de editar parcelado, B confirmar rascunho de A = 404, cancelar não grava, D1 no fluxo real. Evidência do `SetNull` direto no SQL: `Netflix ic|t|t` e `TV ic 50|t|t` (lançamentos gerados ficaram soltos, vínculos null). App/bancos derrubados e datadir apagado ao final.

## NÃO verificado (aceito)

- Postgres foi o 18 (do repositório Ubuntu) em vez do 16 do Docker — mesmas migrações Prisma; risco aceito por ser ambiente descartável de checagem de fluxo, não de SQL exótico.
- A geração da conta fixa vencida materializa na hora (prova no roteiro), mas a retomada de pausada/entitlement não toca o chat (D5).
- Frontend (8c-2): `DraftKind` novos no app + rótulo do `targetChoice` por kind (o cartão inteiro já vem do 8a-2 guiado por `changeAction`).
