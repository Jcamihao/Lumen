# Brief: revisão e correção do item 3b1 (metas, aportes, reservas) — backend e frontend

Para: subagente revisor (sonnet). Relatório final em estilo curto, sem enfeite. Código, comentários e textos persistidos em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`.

## Papel

Você revisa E CORRIGE backend e frontend do item 3b1, e roda tudo de verdade (API real, Postgres, Chrome headless). O item **grava dinheiro e metas** pelo bot e mexe no isolamento entre contas: revisão obrigatória e profunda.

## O que foi feito (por dois `haiku`, já conferido pelo agente principal)

- Backend (`backend/src/conversation/`): leitura nova `envelopes` ("reservas" são envelopes; `goals` só responde "metas"); escrita `create_goal` e `contribute_goal` com rascunho e confirmação; rascunhos tipados (`TRANSACTION`, `GOAL`, `CONTRIBUTION`); `DraftView` com `kind`, `title`, `rows`; novo `parsers/goal.parser.ts`. Verificado: `npx jest` 45 suites e 904 testes verdes; `nest build` ok; `src/conversation` verde em `UTC`, `America/Sao_Paulo`, `Asia/Tokyo`.
- Frontend (`frontend/src/app/features/assistant/assistant-page/` e `core/models/conversation.models.ts`): cartão do rascunho desenha `draft.rows`/`draft.title`; rótulos novos; tipos espelhados. Verificado: `ng test` 247 verdes; `npm run build` ok.
- Nada está commitado. `git status` e `git diff` mostram tudo.

## Leia primeiro

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b1.md`: contrato (fonte única).
2. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-1.md` (seção 7, confirmação) e `...-item-3a.md`.
3. `.superpowers/sdd/conversa-item-3b1/{brief-backend,brief-frontend,duvidas,contrato-tipos}.md`. Avalie cada decisão do dev onde o contrato era omisso.
4. O diff inteiro.

## Duas correções que o agente principal já decidiu (faça e teste)

1. **`criar cofrinho <nome>`** deve criar o rascunho **sem alvo** direto (cofrinho é meta sem alvo): `noTarget: true`, sem perguntar o alvo. `criar meta <nome>` continua perguntando o alvo. Atualize o contrato (seção 3, `create_goal`) com essa regra.
2. **Aporte sem valor cuja meta não existe vai ao Selah.** `guardar dinheiro é importante` (sem `?`, até 6 palavras) hoje vira aporte. Regra nova: quando o texto não traz valor E a meta citada não casa com nenhuma meta ativa, o motor responde como não reconhecido (`HELP` com `unrecognized: true`), sem abrir rascunho e sem pedir valor. Quando traz valor e a meta não existe, continua recusando listando as metas. Teste os dois casos. Atualize o contrato.

## Checklist

A. **Contrato**: frases, ordem do matcher, campos dos rascunhos, textos, `DraftView`, `ReplyData`, fluxos de pergunta pendente, regras de falha (D5), limite do plano ao abrir e ao confirmar. Liste desvios.
B. **Matcher**: nada novo sequestra perguntas ao Selah. Rode um lote grande (mínimo 40) de frases naturais: "quanto devo guardar por mês?", "qual meta merece aporte agora?", "criar uma meta para o ano que vem é boa ideia?", "guardar dinheiro é importante", "colocar dinheiro na poupança vale a pena?", "como criar meta de viagem?", "aporte de emergência"... e frases de comando legítimas variando ordem e conectores. Corrija e teste o que errar.
C. **Isolamento (A/B)**: `userId` só do motor; `goalId` do rascunho vindo de `GoalsService.list(userId)`; `contribute` revalida `id + userId`; confirmar/cancelar rascunho de outra conta falha igual a id inexistente; nada de título de meta de B aparecendo para A.
D. **Idempotência e corrida**: confirmar duas vezes e em paralelo (botão e texto, mesma `messageId`) cria **uma** meta / **um** aporte (uma transferência no extrato). Falha entre reivindicar e aplicar. Janela de duplicação restante: relate.
E. **D5**: `PlanLimitException` e 4xx descartam o rascunho (não voltam em loop) e mostram a mensagem certa; erro inesperado restaura. A regra foi aplicada também a lançamento: confira que não regrediu os testes e o comportamento dos itens 2 e 3a.
F. **Dinheiro**: centavos inteiros; conclusão da meta (`atual + aporte >= alvo`) coerente com o `GoalsService.contribute` real (arredondamento de decimal); percentual no `DONE`; cofrinho sem alvo.
G. **Parser de criar meta/aporte** (`parsers/goal.parser.ts`): nome com números ("viagem 2027"), valor no meio, "3 mil", "3k", "1,234" ambíguo, nome só com conectores, nome gigante (limite 60), emoji, unicode, vazio.
H. **Frontend**: cartão desenha `rows`/`title` de TRANSACTION, GOAL e CONTRIBUTION; formato antigo sem `rows`; `amount`/`date` nulos sem "null"; restauração ("Falta informar: nome/valor-alvo/meta/valor"); botões Confirmar e Cancelar só quando `AWAITING_CONFIRMATION`; duplo clique; sem `innerHTML` novo; nada de dado financeiro em `console.log`/storage; turnos manuais continuam só em memória.
I. **Escopo**: backend só em `backend/src/conversation/`; frontend só nos arquivos do cartão e dos tipos; nenhuma rota, DTO de entrada, tabela, migration ou dependência nova.

## Mutantes de segurança (obrigatório)

Para cada um: aplique, rode `npx jest src/conversation`, anote se algum teste FALHOU (morto) ou nenhum (sobrevivente = lacuna), e **desfaça antes do próximo**. Ao final `git diff` sem resquício.

1. `GoalsService.create` com outro `userId`.
2. `GoalsService.contribute` com outro `userId`.
3. Busca de meta para aporte sem o filtro `status === 'ACTIVE'`.
4. Busca de meta sem restringir ao `userId` (usar lista de outra conta).
5. Remover `assertCanCreate` ao abrir o rascunho de meta.
6. Remover o descarte do rascunho em `PlanLimitException` (voltar a restaurar).
7. Remover o `createTransaction: true` / a data do aporte.
8. Trocar `>=` por `>` na regra "este aporte conclui a meta".
9. `envelopes`: remover o filtro de ativas; remover o limite de 5.
10. `goals`: reintroduzir as frases de "reservas".
11. Remover a checagem de estado `AWAITING_CONFIRMATION` na confirmação de rascunho de meta.
12. Remover `appliedKey` do evento de confirmação de meta.

Cada sobrevivente: escreva o teste que o mata.

## Integração real (obrigatório)

Postgres `lumen-postgres-1` (5433) e Redis `lumen-redis-1` (6380) devem estar de pé (`docker ps`; senão `docker compose up -d postgres redis` na raiz; não mexa em containers de outros projetos). A porta 3001 é de OUTRO projeto: suba o backend em outra porta (ex.: `PORT=3999`, `node dist/main.js` depois de `npx nest build`, com o `.env` da raiz). Para o front, use build/serve apontando para esse backend SEM commitar mudança de ambiente (arquivo temporário fora do que vai ao git; `git diff` final sem `environment*.ts`). Chrome: o puppeteer já está em `~/.cache/puppeteer`; instale `puppeteer-core` só FORA do repo (scratchpad) se precisar; `package.json` e `package-lock.json` intocados. Scripts e capturas só no scratchpad.

Roteiro (cada passo: passou, falhou ou não verificado; capturas nos itens visuais, que você deve ABRIR e julgar):

1. Dois usuários A e B (`/auth/register`; precisa `privacyNoticeAccepted: true`; plano Grátis).
2. Como A: `reservas` mostra envelopes (crie 1 ativa e 1 pausada pela API) e NÃO metas; `metas` mostra metas e não reservas.
3. `criar meta viagem 3 mil` → rascunho com Nome e Alvo; Confirmar → meta existe em `GET /goals` (só em A). Duplo clique em Confirmar: uma meta.
4. `criar meta casa` → pergunta o alvo; `sem alvo` → rascunho de cofrinho; confirmar.
5. `criar cofrinho viagem de 2027`/`criar cofrinho emergencia` → rascunho sem alvo direto (correção 1).
6. Limite do plano Grátis (2 metas ativas): a terceira recusa **ao abrir** o rascunho, com a mensagem do plano.
7. `guardar 200 na viagem` → rascunho de aporte (Meta com progresso, Valor, Data); confirmar → `GET /goals` com `currentAmount` certo e uma transferência em `GET /transactions`; segunda confirmação não duplica.
8. Aporte que completa uma meta: aviso "Este aporte conclui a meta." no rascunho e "Meta concluída." no resultado; status `ACHIEVED`.
9. `guardar 100` com várias metas ativas → pergunta qual (opções); responder `2` escolhe. Com uma só meta: usa ela.
10. `guardar viagem` (sem valor) → "Quanto quer guardar?"; `abc` → erro e o rascunho segue; `150` fecha.
11. `guardar dinheiro é importante` → vai ao Selah (correção 2).
12. Isolamento: B tenta `POST /conversation/confirm` e `/cancel` com o `draftId` de A (404 igual a inexistente); B pergunta `metas`/`reservas`: só vê o dele; aporte de B para "viagem" não acha a meta de A.
13. Meta apagada (`DELETE /goals/:id`) entre o rascunho de aporte e a confirmação: descarta com a mensagem do contrato, sem aporte.
14. Recarregar a página com rascunho de meta aberto: volta com título, linhas e botões.
15. Visual (Chrome headless): capturas do cartão de rascunho de meta, de aporte e de lançamento em tema claro, tema escuro, 390 px e 1280 px; sem rolagem horizontal; alvo de toque ≥ 44 px; foco visível por Tab; Enter aciona.
16. Falha real de Redis/Postgres: NÃO testar; cubra só por teste unitário e diga que não testou.

Se algo não subir, diga exatamente o que falhou e NÃO afirme que o passo passou.

## Limpeza (obrigatória)

Apague os usuários de teste (a cascata do banco remove o resto), as chaves de cache e de rate limit que seus testes criaram no Redis, pare backend, servidor do front, Chrome e qualquer processo seu. `git status` só com os arquivos do item 3b1 e de `.superpowers/`. Sem `.env` nem `environment*.ts` alterados, sem token em arquivo do repo.

## Comandos de verificação (relate a saída resumida)

`backend/`: `npx jest src/conversation`, `npx jest` (inteiro; hoje 45 suites, 904 testes), `npx nest build`, e `src/conversation` em `TZ=UTC`, `TZ=America/Sao_Paulo`, `TZ=Asia/Tokyo`. Lint do backend com config temporária FORA do repo (`eslint:recommended` + `@typescript-eslint/recommended`) sobre `src/conversation/**/*.ts`; o `backend/` não tem config de eslint no repositório e você não cria nem commita uma.
`frontend/`: `npx ng test --watch=false --browsers=ChromeHeadlessCI` (hoje 247) e `npm run build`.
Na raiz, ao final: `graphify update .` (um só, nunca em paralelo).

## Regras

- Corrija direto bug, lacuna de teste, desvio do contrato e problema visual. Contrato errado NÃO muda sozinho: exceto as duas correções acima (que são do agente principal), registre em `.superpowers/sdd/conversa-item-3b1/duvidas.md` e relate.
- Bug fora dos arquivos do escopo: não mexa, relate com o passo que reproduz.
- Todo bug corrigido ganha teste.
- NÃO fazer commit, push, amend, reset nem deploy. Sem segredo em arquivo. Não editar `.env`.

## Relatório final (curto)

1. Achados por severidade (bloqueia / corrigido / observação), com `arquivo:linha`.
2. Tabela dos mutantes: morto ou sobrevivente, e o teste adicionado.
3. Roteiro de ponta a ponta, passos 1 a 16, com caminho completo das capturas.
4. Arquivos alterados por você.
5. Saída resumida dos comandos.
6. Confirmação da limpeza.
7. O que você NÃO conseguiu verificar.
