# Revisão 8a-2 (revisor sonnet) — 2026-11-23

Escopo: `git diff f5d9288..HEAD` (commits 579c229 e cbb6d3e) contra o contrato 8a (§4.4, §5.3, §9-Frontend) e o brief-8a2. Worktree `Lumen-item8a2`, branch `feat/8a2-frontend-editar-apagar`. Nada commitado.

## Veredito

APROVADO COM CORREÇÕES (feitas aqui, não commitadas). O código do 8a-2 estava correto nos pontos críticos. Achei e fechei:

1. **Lacuna do §5.3 (EDIT sem "antes → depois")**: fechada.
2. **Defeito real no DTO**: com o `ValidationPipe` de produção (`enableImplicitConversion: true`, `main.ts`), `delete: "false"`, `1` ou `"x"` viravam `true` e passavam (`Boolean("false") === true`), então uma string podia apagar. Agora só o booleano `true` literal vale.

## Pontos críticos conferidos (sem defeito)

- DELETE só aplica com a flag (`deleteExplicit`) ou com a palavra `apagar` digitada. `confirmar`/`sim`/`ok` e confirmar sem flag nunca apagam.
- Flag em rascunho que não é DELETE: ignorada (editar e criar confirmam normal, 1 vez).
- Versão antiga, 404 e idempotência: intactos. Confirmar por flag segue o mesmo `applyDraft`: relê `id+userId`, usa `appliedKey`, e reconfirmar ou clicar em paralelo aplica uma vez.
- Isolamento: confirmar DELETE de B com `delete:true` pela sessão de A devolve `null` (404), igual ao id inexistente. B segue intacto.
- Prévia do DELETE é relida com `id+userId`. Alvo sumido, inelegível ou de outra conta cai na linha neutra "Lançamento: escolhido". Sem vazamento de descrição ou valor.
- `delete:false` dá 400. Logs sem dados (nenhum log novo no diff, e o teste de logs existente passa).
- Frontend: "Apagar de vez" envia `delete:true` só para `changeAction === 'DELETE'`. EDIT e os outros cartões enviam o corpo sem `delete`. O ghost `apagar` some. O botão fica desabilitado em `manualBusy`. RESTORED usa `changeAction`. "Tentar de novo" mantém a flag.

## Correções feitas

### 1. EDIT com antes → depois (`conversation.service.ts`)
- `toDraftView` do EDIT agora relê o lançamento com `loadTxCandidate(session.userId, targetId)`, o mesmo padrão do DELETE. Só entra se for elegível. Chama o novo `changeDiffRows`.
- `changeDiffRows` monta uma linha por campo que muda de fato (`Valor: R$ 50,00 → R$ 45,00`, `Descrição`, `Categoria: Mercado → Padaria` com "sem categoria" quando não há, `Data: 14/11/2026 → 15/11/2026`).
- O nome da categoria nova vem de `categoryNames(userId, ...)`, filtrado por conta. Sem ids internos.
- Sem mudança efetiva, ou alvo sumido ou inelegível: linha neutra de sempre. Um helper `formatDmy` foi extraído e também serve ao DELETE.
- Testes novos em `transaction-change.spec.ts` (9): linha neutra, valor, vários campos, categoria sem antes, campo igual ao atual (descrição, valor, data e categoria), restauração por GET sem ids, releitura com `{id, userId}`, alvo inelegível ou sumido.
- Testes novos em `isolation.spec.ts` (2): `targetId` de B plantado nos cartões de apagar e editar, e `categoryId` de B plantado na mudança. Nunca aparece descrição, valor ou nome de B.
- Frontend: 1 teste do cartão de EDIT (rows com "→", Confirmar normal, sem aviso de apagar). A tela já renderizava `rows`, então não mudou nenhuma tela.

### 2. DTO `delete` (`confirm-conversation-draft.dto.ts`)
- Adicionado `@Transform(({ obj }) => obj.delete)` antes de `@IsOptional() @Equals(true)`, para o pipe não converter o valor.
- 9 testes novos no controller spec, com as opções reais do pipe: sem `delete` passa, `true` passa, e `false`, `"false"`, `"true"`, `0`, `1`, `"x"`, `[]` dão 400.

### 3. Testes extras
- `conversation-api.service.spec.ts`: `confirmDraft(.., true)` manda `delete:true`. O teste antigo (`toEqual` sem `delete`) já cobria o caso sem flag.
- Spec do assistant-page: "Cancelar" também desabilitado em voo.

## Mutantes (um por vez, revertido entre injeções)

| # | Mutante | Resultado |
|---|---|---|
| B1 | `deleteExplicit` ignorado (DELETE sempre pede a palavra) | MORTO (6) |
| B2 | flag em rascunho não-DELETE bloqueia a confirmação | MORTO (2) |
| B2b | trava de DELETE removida (`confirmar` apaga) | MORTO (2) |
| B3 | prévia DELETE sem `userId` (`where:{id}`) | MORTO (2) |
| B4 | aviso de definitividade (`deleteWarning`) removido do texto | MORTO (1) |
| B5 | `changeAction` omitido no `DraftView` | MORTO (3) |
| B6 | prévia DELETE sem checar elegibilidade | MORTO (1) |
| B7 | linha do EDIT sem `userId` | MORTO (2) |
| B8 | EDIT sem "antes" em valor | MORTO (3) |
| B8b/c/d | EDIT sem "antes" em categoria, data e descrição | MORTO (3, 1, 1) |
| B9 | EDIT sem filtro de igual (só descrição) | **SOBREVIVEU**, então adicionei o teste `it.each` |
| B9a/b/c/d | sem filtro de igual em valor, data, categoria e descrição (após o teste novo) | MORTO (1 cada) |
| B10 | categoria nova do EDIT sem `userId` | MORTO (1) |
| B11 | EDIT relê o alvo mesmo sem mudanças | EQUIVALENTE (só uma query a mais, as linhas saem as mesmas) |
| B12 | rows do EDIT não usam o diff | MORTO (5) |
| B13 | controller manda `true` sempre | MORTO (2) |
| B13b | controller manda `false` sempre | MORTO (1) |
| B13c | controller não repassa a flag | MORTO (2) |
| B14 | DTO sem `@Equals(true)` | MORTO (8) |
| B15 | DTO sem `@IsOptional` | **SOBREVIVEU**, então adicionei o teste com o pipe real, e depois MORTO (1) |
| B16 | DTO sem `@Transform` (defeito real da conversão implícita) | MORTO (4) |
| B17 | palavra `apagar` digitada deixa de confirmar | MORTO (10) |
| B18 | trava de DELETE sem flag desligada | MORTO (2) |
| F1 | `isDeleteDraft` sempre falso | MORTO (6) |
| F2 | API envia `delete:true` sempre | MORTO (1) |
| F3 | filtro `apagar` removido do quickReplies | MORTO (1) |
| F4 | "Apagar de vez" sem `disabled` | MORTO (1) |
| F5 | aviso "Isto apaga de vez..." removido | MORTO (1) |
| F6 | cartão DELETE confirma sem a flag | MORTO (4) |
| F7 | cartão EDIT envia a flag | MORTO (5) |
| F8 | filtro de `cancelar` removido no cartão DELETE | MORTO (1) |
| F9 | botão "Confirmar" também aparece no DELETE | MORTO (5) |
| F10 | texto de chamada igual nos dois cartões | MORTO (1) |
| F11 | "Cancelar" sem `disabled` | **SOBREVIVEU**, então adicionei a asserção, e depois MORTO (1) |

Total: 39 mutantes distintos. 35 MORTOS de primeira (as variantes B9a-d foram reinjetadas depois do teste novo e também morreram). 3 SOBREVIVERAM e foram mortos com teste novo (B9, B15, F11). 1 EQUIVALENTE (B11). Nenhum sobrevivente restante.

## Suítes (final, depois das correções)

- Backend: `tsc` limpo, `nest build` ok, `npx jest --maxWorkers=2` inteiro **1808 passando** (64 suítes). `src/conversation` 715 em UTC, America/Sao_Paulo e Asia/Tokyo.
- Frontend: `tsc` app e spec limpos, karma inteiro **365 passando**, `npm run build` ok.

## NÃO verificado

- Integração real em Postgres 16 e Redis 7 descartáveis (concorrência, falha injetada): não rodei. Os testes usam banco em memória e fakes.
- Navegador real: sem Playwright/E2E do cartão de apagar nem de editar. Verifiquei só DOM em karma.
- Render visual (CSS) do cartão com "→" em larguras estreitas e do botão "Apagar de vez": não olhado. Não há modificador de perigo no design system.
- Caminho completo `ValidationPipe → controller → service` num app Nest real (e2e HTTP): só o pipe isolado, o controller e o service, cada um em separado.
- A prévia do EDIT lê o banco a cada turno e a cada GET (1 a 2 queries a mais): não medi custo.
- O texto do motor do EDIT segue usando `formatCents` ("50,00 -> 45,00") e o cartão usa `formatBrl`. A diferença é cosmética, não mexi.
- Suíte do front com outros navegadores: só Chrome headless.
