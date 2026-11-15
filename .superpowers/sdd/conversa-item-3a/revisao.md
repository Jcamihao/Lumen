# Brief: revisão e correção do item 3a (consultas de Finanças por conversa)

Para: subagente revisor (sonnet). Relatório final em estilo curto, sem enfeite. Código, comentários e textos persistidos em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Trabalhe em `backend/`.

## Papel

Você revisa E CORRIGE. Leia o diff inteiro, rode build e testes, rode mutantes, rode a API de verdade com dois usuários, corrija o que achar e relate. O item lê dados financeiros por usuário (isolamento) e mexe no tratamento de erro de todas as leituras, então a revisão é obrigatória.

## O que foi feito (pelo `haiku`, já conferido uma vez pelo agente principal)

4 consultas novas no motor de conversa (`backend/src/conversation/`): `upcoming_dues`, `installments`, `fixed_bills`, `goals`, mais um ponto único `runRead` que transforma qualquer falha de leitura (antigas e novas) em `ERROR` genérico. Reusam `RecurringTransactionsService.list`, `InstallmentsService.list` e `GoalsService.list`. Estado verificado pelo agente principal: `npx jest` 44 suites e 798 testes verdes; `npx nest build` sem erro; `src/conversation` e `src/dashboard` verdes em `TZ=UTC`, `America/Sao_Paulo` e `Asia/Tokyo`. Nada está commitado; veja `git status` e `git diff`.

Decisão do dev já aceita pelo agente principal (não reabra): a última parcela mostra `remainingAmount` (o materializador faz a última absorver a sobra de arredondamento).

## Leia primeiro

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3a.md`: contrato (fonte única).
2. `.superpowers/sdd/conversa-item-3a/brief.md` e `duvidas.md`: o que foi pedido e as 7 decisões do dev onde o contrato era omisso. Avalie cada uma; se alguma contradiz o contrato ou o produto, corrija e registre.
3. O diff inteiro de `backend/src/conversation/`.

## Checklist

A. **Contrato**: frases, ordem do matcher, filtros, limites (5 e 8), janela de 30 dias, total mensal estimado, percentual com `floor` e teto 100, textos, `ReplyData`. Liste desvios.
B. **Matcher**: nenhuma frase nova captura texto que hoje vai ao Selah. Teste um lote grande de perguntas naturais ("minhas metas estão boas?", "quando vence minha fatura", "metas de emagrecimento do ano", "parcelas do carro: vale a pena?", "recorrências do cartão", "reservas de emergência: quanto devo ter?"). `metas de viagem` hoje casa `goals` (qualquer texto depois de "metas " casa); avalie se isso sequestra perguntas ao Selah e proponha a regra mais estreita se for o caso. Corrija se concluir que é problema, com teste.
C. **Isolamento**: cada consulta passa o `userId` do motor ao serviço, nunca outro valor; nada vem do texto da mensagem; um usuário nunca vê item de outro.
D. **Falha de leitura**: `runRead` cobre todas as leituras; resposta `ERROR` genérica sem detalhe interno; evento sem texto. A falha silenciosa dificulta depurar em produção: **adicione um `Logger` do Nest no `ConversationService`** e, no `catch` de `runRead`, registre só o id da intenção e `error.name` (nunca `error.message`, nunca texto da mensagem, nunca saldo ou descrição). Teste que o log não contém a mensagem do erro.
E. **Datas e fuso**: "hoje" no fuso do usuário via `localToday`; janela correta na fronteira; `dd/mm` no texto; nada depende do fuso do processo.
F. **Dinheiro**: centavos inteiros; arredondamento do total mensal estimado feito uma vez; `WEEKLY × 52 ÷ 12`, `YEARLY ÷ 12`.
G. **Texto**: pt-BR, curto, tom técnico, sem exclamação; descrição do usuário truncada em 60 caracteres sem estourar a linha; nenhum dado de outra conta.
H. **Escopo**: nada fora de `backend/src/conversation/`; sem tabela, rota, DTO ou dependência nova; frontend intocado.

## Mutantes de segurança (obrigatório)

Para cada um: aplique, rode `npx jest src/conversation`, anote se algum teste FALHOU (morto) ou se tudo passou (sobrevivente = lacuna de teste), e **desfaça antes do próximo**. Ao final `git diff` não pode ter resquício.

1. `goals`: repassar outro `userId` ao `GoalsService.list`.
2. `installments`: idem em `InstallmentsService.list`.
3. `fixed_bills`: idem em `RecurringTransactionsService.list`.
4. `upcoming_dues`: idem na chamada de recorrências; depois idem na de parcelas (dois mutantes).
5. `upcoming_dues`: trocar `date < until` por `date <= until`.
6. `fixed_bills` e `upcoming_dues`: remover o filtro `type === EXPENSE`.
7. `installments` e `upcoming_dues`: remover o filtro `remainingInstallments > 0`.
8. `goals`: trocar `floor` por `round` no percentual.
9. `runRead`: remover o `try/catch`.

Cada sobrevivente: escreva o teste que o mata.

## Integração real (obrigatório)

Docker está ligado e os containers `lumen-postgres-1` (porta 5433) e `lumen-redis-1` (6380) devem estar de pé; confirme com `docker ps`; se não, `docker compose up -d postgres redis` na raiz. Não mexa em containers de outros projetos. A porta 3001 é de OUTRO projeto: suba o backend do Lumen em outra porta (ex.: `PORT=3999`), a partir de `backend/dist` depois de `npx nest build`, com o `.env` da raiz.

1. Crie dois usuários de teste pela API de registro (veja `backend/src/auth/`; confirme o e-mail se for exigido em dev). Anote tudo o que criar.
2. Como A, crie pela API: uma conta fixa mensal de despesa (`POST /recurring-transactions`), uma conta fixa de receita, um parcelado em 3x (`POST /installments`), uma meta com alvo e uma sem alvo (`POST /goals`). Como B, crie só uma meta.
3. Como A, pergunte pelo motor (`POST /conversation/message`): `contas fixas`, `minhas parcelas`, `o que vence`, `minhas metas`. Confira: números iguais aos de `GET /recurring-transactions`, `/installments`, `/goals`; receita fora de `fixed_bills`; total mensal estimado correto; última parcela com o valor certo; percentual da meta.
4. Como B, as mesmas perguntas: B vê só a meta de B e nada de A.
5. Vencimento fora da janela de 30 dias não aparece; um dentro aparece.
6. Efeito colateral documentado: crie uma conta fixa com `nextDueDate` já vencida e confirme que perguntar `contas fixas` pelo bot gera o lançamento (como a tela faz), sem duplicar numa segunda pergunta.
7. Uma leitura durante rascunho em coleta (`gastei mercado` e depois `minhas metas`) mantém o rascunho (`GET /conversation/session`).
8. Texto livre longo que contenha as palavras ("quais metas devo priorizar este ano?") continua indo ao Selah (`unrecognized: true`).
9. Simule falha: com o backend rodando, derrube o Redis e o Postgres? **Não.** Em vez disso, cubra a falha só por teste unitário. Diga que não testou falha real.

Limpeza obrigatória no fim: apague os usuários de teste (a cascata remove o resto), as chaves de cache e de rate limit que seus testes criaram no Redis, pare o backend de teste e qualquer processo seu. `git status` só pode mostrar os arquivos do item 3a (e `.superpowers/`). Nenhum `.env` ou arquivo de ambiente alterado, nenhum token em arquivo do repo.

## Comandos de verificação (rode e relate a saída resumida)

Dentro de `backend/`:
1. `npx jest src/conversation`
2. `npx jest` (inteiro; hoje 44 suites, 798 testes)
3. `npx nest build`
4. `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo` com `npx jest src/conversation`
5. Lint: `backend/` não tem config de eslint no repositório. Não crie nem commite config. Use uma config temporária FORA do repo (scratchpad) com `eslint:recommended` + `@typescript-eslint/recommended` sobre `src/conversation/**/*.ts`.
Na raiz, ao final: `graphify update .` (um só, nunca em paralelo).

## Regras

- Corrija direto bug, lacuna de teste e desvio do contrato. Contrato errado NÃO muda: registre em `.superpowers/sdd/conversa-item-3a/duvidas.md` e relate.
- Corrija só em `backend/src/conversation/`. Bug em outro módulo: não mexa, relate com o passo que reproduz.
- Todo bug corrigido ganha teste.
- NÃO fazer commit, push, amend, reset nem deploy. Sem segredo em arquivo. Não editar `.env`.

## Relatório final (curto)

1. Achados por severidade (bloqueia / corrigido / observação), com `arquivo:linha`.
2. Tabela dos mutantes: morto ou sobrevivente, e o teste adicionado.
3. Integração real, passos 1 a 9: passou, falhou ou não verificado.
4. Arquivos alterados por você.
5. Saída resumida dos comandos.
6. Confirmação da limpeza.
7. O que você NÃO conseguiu verificar.
