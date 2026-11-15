# Brief: revisão e correção do item 2a (backend de Finanças por conversa)

Para: subagente revisor (sonnet). Relatório final em estilo curto, sem enfeite. Código, comentários e docs em prosa normal, em português.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Trabalhe em `backend/`.

## Papel

Você revisa E CORRIGE. Leia o diff inteiro, rode build, lint e testes, rode os mutantes de segurança, corrija o que achar e relate o que mudou. Este item é de segurança (isolamento entre contas, idempotência de dinheiro), então a revisão é obrigatória e profunda.

## O que foi feito (por outro agente, já conferido uma vez pelo agente principal)

Motor de conversa do canal APP: `backend/src/conversation/` (service, controller, DTOs, parsers, replies, types, specs), 2 models Prisma (`ConversationSession`, `ConversationEvent`) com migration `backend/prisma/migrations/20261115120000_conversation_item_2/`, registro em `backend/src/app.module.ts`. Estado atual verificado pelo agente principal: `npx jest` 44 suites e 717 testes verdes, `npx nest build` sem erro. O agente principal já corrigiu uma coisa: a data do lançamento agora vai à meia-noite UTC (igual à tela de Finanças), não ao meio-dia.

Nada está commitado. Veja o que é novo com `git status` e `git diff`.

## Leia primeiro

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-1.md`: contrato aprovado (fonte única). Seções 2, 5, 6, 7 e 9 são as que mais importam.
2. `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md`: seção "Isolamento obrigatório entre contas".
3. `.superpowers/sdd/conversa-item-2/brief.md`: o que foi pedido ao desenvolvedor.
4. `.superpowers/sdd/conversa-item-2/duvidas.md`: 7 decisões que o desenvolvedor tomou onde o contrato era omisso. Avalie cada uma; se alguma contradiz o contrato ou a spec, corrija e registre.

## Checklist de revisão

A. **Contrato**: cada rota, DTO, enum, model e regra da seção 5, 6 e 7 do contrato está implementada como escrito? Liste desvios.
B. **Isolamento**: todo acesso a `ConversationSession` e `ConversationEvent` leva `userId` no `where`. Nenhum caminho aceita `userId`, `channel` ou `accountId` do corpo. Resposta de "não é seu" idêntica à de "não existe" (404 igual). Logs e erros não vazam texto, saldo ou id alheio.
C. **Idempotência e corrida**: mesma `messageId` duas vezes; confirmar duas vezes; duas confirmações em paralelo; falha ao gravar o lançamento; falha entre reivindicar e aplicar. Há janela em que dois lançamentos nascem, ou em que a mensagem duplicada cai em erro 500 por violação de unicidade não tratada? O check de `messageId` duplicada (`findFirst`) e o `create` do evento são atômicos? Se não, o que acontece sob concorrência?
D. **Dinheiro e data**: centavos inteiros no rascunho; conversão para reais só ao aplicar; arredondamento; limites (zero, negativo, > 1.000.000); data no fuso do usuário (`localToday`), gravada à meia-noite UTC; `TRANSFER` não é tocado.
E. **Parser**: formatos de valor e data do contrato; casos ambíguos pedem reenvio ou pergunta, nunca palpite. Procure entradas que quebram (texto enorme, só espaços, unicode, `NaN`, `Infinity`, notação científica, valor com muitos zeros).
F. **Texto e templates**: respostas em pt-BR, curtas, sem inventar dado; nenhuma resposta exibe dado de outra conta.
G. **Fora do escopo**: nada em `frontend/`, nada no `AssistantService`, nenhuma dependência npm nova.

## Mutantes de segurança (obrigatório)

Para cada mutante: aplique a mudança, rode `npx jest src/conversation`, anote se algum teste FALHOU (mutante morto = bom) ou se tudo passou (mutante sobrevivente = lacuna de teste), e **desfaça a mudança antes do próximo**. Ao final `git diff` não pode conter nenhum resquício de mutante.

1. Remover `userId` do `where` da busca de sessão em `confirmDraft`.
2. Remover `userId` do `where` da busca de sessão em `cancelDraft`.
3. Remover `userId` do `where` do `deleteMany` de reivindicação em `applyDraft`.
4. Remover `userId` do `where` do `findFirst` de duplicidade de `messageId`.
5. Remover `version` do `where` do `deleteMany` de reivindicação.
6. Trocar a checagem de estado `AWAITING_CONFIRMATION` por qualquer estado na confirmação por texto.
7. Remover a gravação de `appliedKey` no evento.
8. Aceitar `confirmar` quando a sessão está expirada (remover a checagem de `expiresAt`).

Cada mutante sobrevivente: escreva o teste que o mata, na pasta `backend/src/conversation/`.

## Integração real (obrigatório)

O Postgres local do Lumen está em `localhost:5433` (migration já aplicada). Suba a API (`npm run dev:backend` na raiz, ou `node` do `dist` após `npx nest build`; escolha o que funcionar), registre/entre com DOIS usuários de teste e rode via HTTP:

1. A manda `50 mercado`, recebe `CONFIRM_DRAFT`; A confirma; confira que o lançamento existe só na conta A.
2. B tenta `POST /conversation/confirm` e `/cancel` com o `draftId` de A: 404 idêntico ao de id inexistente.
3. Corpo com `userId` extra: 400.
4. Mesma `messageId` duas vezes: segunda devolve `DUPLICATE`, uma só mensagem processada.
5. Duas confirmações em paralelo (`curl` simultâneo): um lançamento só.
6. `GET /conversation/session` reflete o estado.
7. Leituras: `saldo`, `resumo`, `quanto gastei`, `gastos com mercado`, `cartao`, `ajuda`. O saldo e o total do mês do bot batem com `GET` do dashboard (`/dashboard/summary` ou rota equivalente que você encontrar)?
8. **Cache do dashboard**: depois de confirmar um gasto pelo bot, o resumo do dashboard já reflete o gasto? (Pergunta aberta do agente principal: `DashboardService.getSummary` usa cache; `TransactionsService.create` chama `lifeEngineService.touchUserData`. Verifique se isso invalida o cache. Se não invalida, o bot e a tela divergem; corrija da forma mais simples e segura.)

Se não conseguir subir a API, diga exatamente o que falhou e NÃO afirme que a integração passou.

Limpe os dados de teste que você criar (apague os 2 usuários de teste e seus registros) ao final, só os seus.

## Lint

`backend/` não tem config de eslint no repositório. Não crie nem commite config. Para checar, use uma config temporária FORA do repositório (por exemplo em `/tmp`) com `eslint:recommended` + `@typescript-eslint/recommended` sobre `src/conversation/**/*.ts`, e relate. Não rode `npm run lint` (tem `--fix` na árvore toda).

## Comandos de verificação (rode e relate a saída resumida)

Dentro de `backend/`:
1. `npx jest src/conversation`
2. `npx jest` (suíte inteira; hoje 44 suites, 717 testes)
3. `npx nest build`
Ao final, na raiz: `graphify update .` (um só, nunca em paralelo).

## Regras

- Corrija direto o que achar (bug, lacuna de teste, desvio do contrato). Mudança de contrato NÃO: se o contrato estiver errado, registre em `.superpowers/sdd/conversa-item-2/duvidas.md` e relate; o dono decide.
- Corrija só dentro de `backend/src/conversation/`, `backend/prisma/` (se a migration estiver errada) e testes. Se a correção exigir mexer em outro módulo (ex.: invalidação de cache do dashboard), faça o mínimo, explique no relatório e aponte o arquivo.
- NÃO fazer commit, push, amend, reset nem deploy.
- Não por segredo, chave ou senha em arquivo nenhum.
- Não mexer nos containers `agilis-*`.

## Relatório final (curto)

1. Achados por severidade (bloqueia / corrigido / observação), cada um com `arquivo:linha`.
2. Tabela dos 8 mutantes: morto ou sobrevivente, e o teste adicionado.
3. Resultado de cada passo da integração real (1 a 8): passou, falhou ou não verificado.
4. Arquivos alterados por você.
5. Saída resumida dos comandos de verificação.
6. O que você NÃO conseguiu verificar.
