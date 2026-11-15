# Resultado da revisão do item 3b1

Data: 2026-11-15. Revisão retomada por um subagente e conferência independente do agente principal. O Sonnet previsto na regra do dono não estava disponível; foi usado o modelo disponível, com esse limite informado. Nenhum commit, push ou deploy foi feito.

## Achados e correções

1. **Corrigido, financeiro:** `backend/src/goals/goals.service.ts:101`. O aporte atualizava o saldo antes de criar a transferência. Se a segunda operação falhasse, o motor restaurava o rascunho e a repetição somava o aporte novamente. O dono autorizou ampliar o escopo para o serviço de metas e seus testes. Agora uma transação Prisma contém o bloqueio parametrizado da meta por `id + userId`, a leitura do saldo, a atualização e a transferência. Aportes distintos à mesma meta são serializados pelo bloqueio da linha. A verificação real de rollback e concorrência foi executada pelo agente principal em Postgres descartável.
2. **Corrigido, financeiro:** `backend/src/goals/goals.service.ts:55`, `:141` e `:151`. Falhas de cache ou notificação depois de persistir a criação/aporte eram devolvidas como erro, incentivando uma repetição que duplicaria a ação. Esses efeitos auxiliares agora registram somente operação e nome do erro e não mudam o retorno financeiro de sucesso. Não há retry automático desses efeitos; cache ou notificação podem ficar atrasados após uma falha.
3. **Corrigido, escolha de destino:** `backend/src/conversation/conversation.service.ts:711`. Se uma meta oferecida deixasse de estar ativa, a lista era compactada e o mesmo número podia escolher outra meta. A escolha agora resolve o id originalmente oferecido. Uma posição removida aparece como `indisponível`; os números restantes continuam estáveis.
4. **Corrigido, confirmação visual:** `backend/src/conversation/conversation.service.ts:1392` e `:1423`. O frontend substitui o texto de confirmação por uma chamada curta, escondendo o aviso de conclusão da meta e o de data futura. Os avisos agora fazem parte de `draft.rows`, com rótulo `Aviso`, e ficam visíveis também ao restaurar o cartão. A regressão DOM está em `frontend/src/app/features/assistant/assistant-page/assistant-page.component.spec.ts:568`.
5. **Lacuna de teste corrigida:** o limite de cinco reservas era verificado apenas no texto. O mutante que devolvia sete itens em `data.envelopes` sobreviveu. A asserção do tamanho do payload foi adicionada em `conversation.service.spec.ts`, no teste `mais de 5 ativas`; o mutante passou a morrer.
6. **Já presentes e conferidas:** `criar cofrinho` nasce sem alvo, preservando números no nome; aporte sem valor cujo nome não corresponde a meta ativa responde como não reconhecido, permitindo o fallback. Os testes e o contrato cobrem essas decisões da revisão anterior.

## Verificações executadas pelo subagente

| Comando | Resultado |
|---|---|
| `backend: npx jest src/conversation --runInBand`, base | 6 suítes, 344 testes aprovados |
| `backend: npx jest src/goals src/conversation --runInBand`, após correções | 7 suítes, 381 testes aprovados |
| `backend: npx jest --runInBand`, final | 45 suítes, 963 testes aprovados |
| `TZ=UTC npx jest --runInBand --silent` | 45 suítes, 963 testes aprovados |
| `TZ=America/Sao_Paulo npx jest --runInBand --silent` | 45 suítes, 963 testes aprovados |
| `TZ=Asia/Tokyo npx jest --runInBand --silent` | 45 suítes, 963 testes aprovados |
| `backend: npx nest build` | Aprovado, inclusive depois das correções |
| `frontend: npx ng test --watch=false --browsers=ChromeHeadlessCI` | 248 testes aprovados em Chrome Headless 148 |
| `frontend: npm run build` | Aprovado |
| `git diff --check` | Aprovado |

O backend não tem configuração ESLint no repositório. Foi usada configuração temporária em `/tmp/lumen-3b1-checks.PO5I9Q/.eslintrc.cjs`, com `eslint:recommended` e `@typescript-eslint/recommended`. A execução estrita encontrou 40 ocorrências legadas de `no-explicit-any`: três no spec de conversation, 36 no spec de goals e uma no serializador de goals. As mesmas ocorrências já existem nos arquivos de `HEAD`; os dois specs foram conferidos também com entrada via `git show`. Nenhum `any` novo ficou nas correções. Com apenas essa regra desativada, a execução completa dos arquivos revisados termina sem erro. Portanto o lint estrito **não está verde**, e essa dívida não foi confundida com regressão desta entrega.

## Mutantes

Cada variante abaixo foi aplicada isoladamente ao código, seguida por `npx jest src/conversation --runInBand`, e desfeita antes da seguinte. As mortes abaixo são falhas de asserção, não de compilação. Foram 14 variantes dos 12 itens do brief. As tentativas iniciais de aplicar duas substituições não encontraram o trecho; ambas foram reaplicadas corretamente e executadas. O estado final não contém mutantes.

| Item | Mutação | Resultado e teste que detecta |
|---|---|---|
| 1 | `GoalsService.create` com outro dono | Morto; chamada com `userId` da conta que confirma e testes de criação |
| 2 | `GoalsService.contribute` com outro dono | Morto; chamada com dono, id e data esperados |
| 3 | Remover filtro de meta ativa | Morto; meta pausada não pode ser escolhida |
| 4 | Remover defesa de `userId` na lista de metas | Morto; serviço fake devolve meta de B para A e o motor deve rejeitar |
| 5 | Remover limite ao abrir rascunho | Morto; plano recusa antes de criar sessão |
| 6 | Restaurar rascunho após `PlanLimitException` | Morto; teste exige descarte após limite surgir na confirmação |
| 7a | `createTransaction: false` | Morto; argumentos obrigatórios de `contribute` |
| 7b | Alterar data do aporte | Morto; data do dia do rascunho exigida no serviço |
| 8 | Trocar `>=` por `>` na conclusão | Morto; aporte que iguala exatamente o alvo |
| 9a | Remover filtro de reserva ativa | Morto; pausadas ficam fora da lista |
| 9b | Devolver todas as reservas no payload | Sobreviveu inicialmente; morto após teste exigir cinco itens também em `data.envelopes` |
| 10 | Mapear `reservas` novamente para metas | Morto; matcher e motor distinguem envelopes de goals |
| 11 | Remover estado exigido na confirmação | Morto; rascunho de meta em coleta não confirma pelo botão |
| 12 | Não gravar `appliedKey` | Morto; eventos de meta/aporte exigem chave `sessão:versão` |

Os testes de goals conferem também o filtro do dono na consulta parametrizada do bloqueio e na leitura Prisma dentro da transação, a ausência de escrita em meta inexistente/alheia e o retorno de sucesso apesar de falha auxiliar posterior. O rollback real e a concorrência financeira não foram inferidos de mocks: foram exercitados separadamente pelo agente principal.

## Integração real executada pelo agente principal

Fonte de evidências: `.superpowers/sdd/conversa-item-3b1/conferencia-principal.md`, `/tmp/lumen-review-3b1.ugN48X/integration-results.json` e `/tmp/lumen-review-3b1.ugN48X/atomicity-results.json`. Os dois JSONs foram lidos pelo subagente. O banco foi criado exclusivamente para a revisão, recebeu as 26 migrations e não continha dados existentes do dono. Docker estava indisponível; foram usados binários extraídos em `/tmp`, sem instalar serviços no sistema. O modo billing da instância descartável foi ativado para exercitar o limite do Grátis, sem iniciar checkout.

| Passo do brief | Resultado |
|---|---|
| 1 | Aprovado: duas contas sintéticas cadastradas pela API |
| 2 | Aprovado: reservas são envelopes; leitura isolada |
| 3 | Aprovado: criar meta e confirmar em paralelo grava uma vez |
| 4 | Aprovado: pergunta de alvo e criação de cofrinho |
| 5 | Aprovado: cofrinho com número no nome não pergunta alvo |
| 6 | Aprovado: terceira meta ativa recusada antes de abrir rascunho |
| 7 | Aprovado: aporte/transferência certos e segunda confirmação sem duplicação |
| 8 | Aprovado: aviso visível no Chrome e status final de meta concluída |
| 9 | Aprovado: escolha numerada e coleta de valor |
| 10 | Aprovado no roteiro de coleta: erro de valor intermediário e preenchimento posterior; registrado com o passo 9 no JSON |
| 11 | Aprovado: frase natural sinalizada como não reconhecida; provedor LLM não foi chamado |
| 12 | Aprovado: B não confirma/cancela rascunho de A, nem aporta na meta de A |
| 13 | Aprovado: meta apagada provoca erro e descarte |
| 14 | Aprovado no Chrome: rascunho reaparece após recarregar |
| 15 | Aprovado no Chrome: temas claro/escuro, 390/1280 px, sem overflow, botões de pelo menos 44 px, foco e confirmação por Enter |
| 16 | Não executado: queda real de Postgres/Redis é proibida pelo brief; falhas foram injetadas sem derrubar serviços |

Os fluxos de negócio foram exercitados principalmente por HTTP; os cartões, restauração, foco, Enter e conclusão foram exercitados também no Chrome. O agente principal confirmou que abriu e julgou as 12 capturas, repetiu a rodada final com resultado verde e concluiu a limpeza: zero usuários/transações/metas sintéticos remanescentes, Redis com zero chaves e portas 3999/4399/55439/56389 fechadas. Browser, API, frontend, Postgres e Redis temporários foram encerrados. A evidência está também na conferência dele.

As 12 capturas estão em `/tmp/lumen-review-3b1.ugN48X/`: `meta-light-390.png`, `meta-light-1280.png`, `meta-dark-390.png`, `meta-dark-1280.png`, `aporte-light-390.png`, `aporte-light-1280.png`, `aporte-dark-390.png`, `aporte-dark-1280.png`, `lancamento-light-390.png`, `lancamento-light-1280.png`, `lancamento-dark-390.png`, `lancamento-dark-1280.png`.

O script de atomicidade usou Prisma e transação reais: falha da transferência reverteu o saldo a zero e permitiu restaurar o rascunho; a repetição registrou R$ 100 e uma transferência. Oito aportes distintos simultâneos de R$ 10 deixaram saldo de R$ 180 e nove transferências contando a primeira. Cache e notificação falhando após commit mantiveram sucesso financeiro. Outro dono recebeu 404 sem mudar o saldo.

## Arquivos alterados nesta retomada pelo subagente

- `backend/src/conversation/conversation.service.ts`: números estáveis nas escolhas e avisos nas linhas do cartão.
- `backend/src/conversation/conversation.service.spec.ts`: regressões dos números, avisos e limite de reservas no payload.
- `backend/src/goals/goals.service.ts`: transação/bloqueio e isolamento de efeitos auxiliares pós-persistência.
- `backend/src/goals/goals.service.spec.ts`: testes da transação, dono e falhas auxiliares.
- `frontend/src/app/features/assistant/assistant-page/assistant-page.component.spec.ts`: avisos visíveis antes de confirmar e ao restaurar.
- Este relatório. Os demais arquivos modificados já pertenciam ao desenvolvimento anterior e foram preservados.

## Limites e pendências

A janela já documentada entre reivindicar a sessão e efetivar a ação continua existindo: queda do processo nesse intervalo pode perder o rascunho. Não foi introduzida outbox, migration ou nova rota. A correção de atomicidade não promete recuperação transparente dessa queda.

Notificações ou cache que falham depois do commit não são repetidos automaticamente. Campos de texto livre em coleta que começam por número ou verbo de comando continuam sujeitos à regra anterior do roteador; esse limite já estava registrado em `duvidas.md` e não foi ampliado nesta correção. O fallback foi conferido por `unrecognized`, sem depender de resposta de provedor externo. Produção, Asaas sandbox e aparelhos físicos não foram testados nesta revisão.

O agente principal aplicou `ponytail-review` ao diff e não encontrou simplificação necessária. HANDOFF e atualização final do graphify ficam com ele. O subagente não criou usuários nem iniciou servidores de negócio; seus processos de teste e build terminaram. Os artefatos temporários de configuração e evidência permanecem em `/tmp` para auditoria, fora do git, sem credenciais de produção.
