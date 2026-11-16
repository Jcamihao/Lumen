# Brief de revisão e correção: item 3b2b (conta fixa e compra parcelada), backend e frontend

Para: subagente revisor (sonnet). Relatório final em estilo curto, sem enfeite. Código, comentários e textos persistidos em português do Brasil, prosa normal.
Projeto: `/home/caminhao/coding/codeStage/Lumen`. Data: 2026-11-16. Relatório: `.superpowers/sdd/conversa-item-3b2b/resultado-revisao.md`.

## Papel

Você revisa E CORRIGE backend e frontend e roda tudo de verdade: Postgres novo e descartável, API real, Chrome headless. O item **grava dinheiro** (conta fixa e compra parcelada) e **muda serviços compartilhados com as telas**. Revisão obrigatória e profunda.

## O que foi feito (dois `haiku`; conferido pelo agente principal)

- Backend: `RecurringTransactionsService.createForConversation` e `InstallmentsService.createForConversation` (núcleo de gravação compartilhado com a tela, recibo, commit de resultado desconhecido, condição revisável de primeiro vencimento no passado, flags `materializationPending`/`refreshPending`); parcela mínima de R$ 0,01 no serviço (vale para a tela); motor: `create_recurring`/`create_installment`, rascunhos `RECURRING`/`INSTALLMENT`, `parsers/write-body.parser.ts`, cartões, três resultados de gravação.
- Frontend: tipos, rótulos de campo pendente e a etiqueta do cartão de resposta ("Criado" para conta fixa e parcelado; "Lançado" nos demais).
- Verificado pelo agente principal: `tsc` limpo; `npx jest` 47 suites e 1162 testes verdes; `nest build` ok; `src/conversation`, `src/recurring-transactions`, `src/installments` verdes em `UTC`, `America/Sao_Paulo`, `Asia/Tokyo` (607); 20 execuções seguidas do módulo sem falha; frontend `ng test` 270 verdes e `npm run build` ok. O `haiku` relatou 15 mutantes mortos (não confie: refaça). Nada commitado.

## Leia primeiro

1. `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md` (seções 1 a 7 e 9): **fonte única**.
2. `.superpowers/sdd/conversa-item-3b2b/{brief-backend,brief-frontend,contrato-tipos,duvidas}.md` e `.superpowers/sdd/conversa-item-3b2a/resultado-revisao.md` (padrão e critérios do 3b2a).
3. O diff inteiro (`git status`, `git diff`, arquivos novos) e, no `duvidas.md`, cada decisão do dev onde o contrato era omisso. Avalie cada uma.

## Pontos que o agente principal quer ver exercitados

1. **Mudanças de comportamento HTTP nas telas** (aceitas, mas prove): `POST /recurring-transactions` e `POST /installments` agora (a) apararam e validam descrição de 2 a 120; (b) não viram 500 se a materialização ou `touchUserData` falharem depois de gravar (201); (c) `POST /installments` recusa parcela menor que R$ 0,01 (R$ 1,00 em 60 vezes → 400). Confirme que o **formato das respostas** das telas não mudou, que `GET /recurring-transactions` e `GET /installments` seguem iguais, e que o calendário (`nextDueDate`, `installmentsGenerated`, mensal no dia 31) não regrediu.
2. **Materialização real**: primeiro vencimento hoje gera o lançamento no Postgres real; futuro não gera; a regra aparece em `GET /recurring-transactions`; nova confirmação do mesmo rascunho não duplica (uma regra, um lançamento por data, uma parcela por número).
3. **Divisão do parcelado**: some `installmentAmount × (n−1) + última == total` em centavos para uma bateria de totais e quantidades (inclua R$ 0,01 em 2, R$ 1,00 em 60, R$ 10,00 em 3, R$ 99.999.999,99 em 60); parcelas e total mostrados no cartão batem com o que o serviço grava e com as parcelas geradas pelo materializador.
4. **Parser** (`parsers/write-body.parser.ts`): o dev documentou limites ("seguro anual" vira anual; "geladeira 1200 em 12x" fica com descrição "geladeira 1200"). Rode um lote grande (mínimo 60 frases) de entradas naturais e malformadas: `12x de 100`, `em 12x` sem total, datas inválidas (31/02, 29/02 em ano não bissexto), `hoje`, `amanhã`, ISO, duas datas, sufixos repetidos, descrição com números, emoji, unicode, texto de 500 caracteres, 20/21 palavras, `?`. Nenhuma frase de conversa livre pode virar escrita.
5. **Condição revisável**: data que vira passada entre o rascunho e a confirmação (relógio simulado) não grava, sobe a versão, volta para coleta de 15 minutos pedindo novo vencimento, mostra o motivo em `Atenção` (também em `GET /conversation/session` e após recarregar). Versão antiga nunca aplica o rascunho atualizado.
6. **Três resultados de gravação** em transação real (bootstrap de teste fora do repo, sem derrubar serviços): rollback conhecido restaura; commit de resultado desconhecido (ack perdido e rollback real) não restaura e não libera a `appliedKey`; materialização e `touchUserData` falhando depois do commit viram `DONE` com o aviso certo, sem novo rascunho e sem segunda regra por retry.
7. **Plano**: Grátis com billing ligado só no ambiente de teste (3 contas fixas e 2 parcelados ativos): recusa ao abrir e ao confirmar, mensagem do domínio.
8. **Flutuação**: o dev viu uma vez 1 teste do motor falhar sem guardar o log; o agente principal rodou 20 vezes sem reproduzir. Rode a suíte do motor ao menos 30 vezes e guarde qualquer log de falha; se achar a causa (relógio real, ordem, mutante concorrente), corrija.

## Checklist de revisão

A. Contrato: gramática (seção 4), rascunhos e cartões (seção 5), planos e erros (seção 6), exigências de teste (seção 7). Liste desvios.
B. Isolamento A/B: `userId` só do motor; confirmar/cancelar/restaurar rascunho alheio falha igual a inexistente; A e B não veem regras uma da outra; nada de descrição de B em resposta de A.
C. Idempotência: confirmar duas vezes e em paralelo (botão e texto, mesma `messageId`) cria uma regra/compra; corrida com a tela.
D. Dinheiro e datas: centavos inteiros; datas em UTC, São Paulo e Tóquio (hoje, 1º do mês, ano omitido sem saltar, passado recusado, teto de dois anos, meia-noite); mensal no dia 31.
E. Logs e erros: só id da intenção/operação e `error.name`; nenhuma mensagem de usuário, descrição ou valor em log, evento ou erro.
F. Frontend: cartões de conta fixa e parcelado (duas linhas "Aviso", linha "Atenção"), campos pendentes, restauração, erro de commit desconhecido sem retry, etiqueta "Criado"/"Lançado"; nada em `localStorage`/`sessionStorage`/`console`; sem `innerHTML` novo.
G. Escopo: backend só em `conversation/`, `recurring-transactions/`, `installments/`; frontend só nos arquivos do cartão e dos tipos; nada de rota, DTO HTTP, schema, migration, billing ou dependência nova.

## Mutantes obrigatórios (cada um sozinho, desfeito antes do próximo; morte por asserção)

1. Outro `userId` em `createForConversation` (conta fixa) e em `createForConversation` (parcelado), e na criação via tela.
2. Sem `assertCanCreate` no núcleo (conta fixa e parcelado) e sem ele ao abrir o rascunho (motor).
3. Sem a regra `notBefore: 'today'` (conta fixa e parcelado); regra trocada para `<=`.
4. Sem a validação de parcela mínima; mínima trocada para R$ 0,00.
5. Restaurar o rascunho após commit desconhecido; liberar `appliedKey` nesse caso.
6. Restaurar o rascunho quando só a materialização ou `touchUserData` falha depois do commit.
7. Recibo dependendo de leitura posterior (`findOwned`, `toRecurringResponse`, `toInstallmentResponse`).
8. Revisão de data sem subir a versão; revisão que sobrescreve outro rascunho aberto.
9. Remover `AWAITING_CONFIRMATION`, a reivindicação exclusiva ou a `appliedKey` na confirmação.
10. Sufixo de frequência removendo palavra do meio da descrição; `12x de 100` lido como total.
11. Gravar com `type: 'INCOME'`; gravar categoria ou pagamento presumidos (crédito no parcelado).
12. Último termo: etiqueta "Criado" aplicada a `transactionId`.

Cada sobrevivente: escreva o teste que o mata.

## Integração real (obrigatória)

- **Infra descartável**: contêineres próprios (`docker run --rm`) de Postgres 16 e Redis em portas livres (confira com `ss -ltn`; por exemplo 55459 e 56409), banco novo, as migrations do repositório com `prisma migrate deploy` (DATABASE_URL só no ambiente do processo, nunca editando `.env`) e `prisma migrate diff` sem diferença. Backend em outra porta (ex.: 3999), front estático em outra (ex.: 4399), billing ligado só ali, sem checkout. **Nunca** use ou pare a porta 55439 (Postgres do Bora, dados reais), a 3001 (outro projeto) nem o banco antigo do Lumen na 5433 (tem migration fora do repo). Se o Docker não estiver utilizável, extraia binários sob o scratchpad.
- Chrome headless: puppeteer em `~/.cache/puppeteer`; `puppeteer-core` só FORA do repositório. Capturas e scripts só no scratchpad; **abra e julgue** as capturas (claro/escuro, 390 e 1280 px, overflow, toque de 44 px, foco visível, Enter).
- Falhas e relógio injetados por bootstrap de teste fora do repositório. Não derrube serviços compartilhados.

Roteiro (cada passo: passou, falhou ou não verificado):
1. Duas contas A e B no plano Grátis.
2. Conta fixa: criar com vencimento hoje (lançamento gerado, uma vez), futuro (sem lançamento), mensal no dia 31; terceira conta ativa passa, quarta é recusada ao abrir; B não vê as de A.
3. Parcelado: total e quantidade dividindo exato e com sobra; hoje gera a 1ª parcela; R$ 1,00 em 60 recusado no bot **e** em `POST /installments`; terceiro parcelado recusado pelo plano.
4. Confirmação em paralelo (6 confirmações): um cadastro. Cancelar não grava. Recarregar com rascunho aberto restaura.
5. Falhas controladas (itens 6 de "Pontos que o agente principal quer ver").
6. Relógio simulado: vencimento que vira passado entre rascunho e confirmação.
7. Telas: `GET`/`POST` das duas rotas com o mesmo formato de antes.
8. Chrome: os cartões de conta fixa e parcelado, coleta, revisão, `DONE` com e sem aviso, commit desconhecido, em claro/escuro e 390/1280 px.

## Limpeza (obrigatória)

Remova só o que você criou: usuários, bancos, contêineres, chaves de cache e rate limit, processos (backend, front, Chrome), arquivos temporários. `git status` apenas com mudanças do escopo. Nenhum `.env`, `environment*.ts`, `package*.json` alterado; nenhum token em arquivo do repo.

## Comandos (relate a saída resumida com números reais)

`backend/`: `npx tsc --noEmit`; `npx jest src/conversation src/recurring-transactions src/installments`; `npx jest`; `npx nest build`; os três módulos em `TZ=UTC`, `TZ=America/Sao_Paulo`, `TZ=Asia/Tokyo`. Lint: sem config no repositório; use uma config temporária FORA do repo (`eslint:recommended` + `@typescript-eslint/recommended`), compare com a dívida de `any` documentada, não crie nem commite config. `frontend/`: `npx ng test --watch=false --browsers=ChromeHeadlessCI`; `npm run build`. Não rode `graphify` (o agente principal roda).

## Regras

- Corrija direto bug, lacuna de teste, desvio do contrato, problema visual. Contrato errado NÃO muda: registre em `duvidas.md` e relate. Bug fora do escopo: relate com o passo que reproduz.
- Todo bug corrigido ganha teste. Mutante sobrevivente ganha teste.
- Se a API acusar limite de uso, pare e diga exatamente onde parou.
- Sem commit, push, amend, reset ou deploy. Sem segredo em arquivo.

## Relatório final (curto; também em `resultado-revisao.md`)

Achados por severidade (com `arquivo:linha`), tabela de mutantes (morto/sobrevivente e teste adicionado), roteiro de integração passo a passo (passou/falhou/não verificado, com caminho completo das capturas), arquivos alterados por você, comandos com saída resumida, limpeza confirmada e o que NÃO foi verificado.
