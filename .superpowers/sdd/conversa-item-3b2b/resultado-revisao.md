# Resultado da revisão e correção: item 3b2b (conta fixa e compra parcelada por conversa)

Data: 2026-11-16. Revisor: subagente sonnet (continuação do revisor anterior, interrompido no meio da integração). Estado de partida: HEAD `4e02e49` (3b2b commitado). Nada foi commitado nesta revisão: as correções estão na árvore de trabalho, sem commit.

## Veredito

O 3b2b está correto no que foi exercitado. A revisão achou **1 bug real no frontend** (impede responder "3" à pergunta de quantidade de parcelas) e **9 lacunas de teste** (mutantes sobreviventes). Tudo corrigido, com teste que falha sem a correção. Nenhum bug de dinheiro, de isolamento ou de idempotência foi encontrado no backend.

## Bug achado e corrigido

**Frontend: resposta de 1 caractere não podia ser enviada.** O formulário da página do assistente tinha `Validators.minLength(2)` na pergunta. A pergunta do parcelado é "Em quantas parcelas? Responda um número de 2 a 60.". As respostas de 2 a 9 parcelas têm 1 dígito, então o botão "Enviar pergunta" ficava desabilitado e o usuário não conseguia responder "3" (só "3x" ou "03"). Achado no Chrome real: o cartão do parcelado ficava preso em "Quantidade: a informar". Os testes anteriores não pegaram porque usavam o motor simulado e nunca digitavam um dígito só.

Correção (somente `assistant-page.component.{ts,html}`): o validador do formulário ficou só `required`; um método `canSubmitQuestion()` exige 2 caracteres para pergunta nova e 1 caractere quando existe campo pendente no rascunho do assistente manual. `ask()` e o botão usam o método. Pergunta nova ao Selah continua com mínimo de 2.

Testes novos (frontend, `assistant-page.component.spec.ts`): "com campo pendente, a resposta de um caractere ('3' parcelas) é enviada" (falhou antes da correção: `TOTAL: 1 FAILED, 54 SUCCESS`; passa depois) e "sem rascunho com campo pendente, uma pergunta de um caractere não é enviada ao assistente nem ao Selah" (garante que o mínimo de 2 continua valendo fora da coleta).

## Mutantes

Harness em `scratchpad/r3b2b/mut/run-mutants.js` (fora do repositório): aplica uma troca de texto, roda o módulo, restaura sempre e confere `git diff --stat` do arquivo. Saídas em `out-a.txt`, `out-b.txt`, `out-rerun.txt`. Após cada mutante o `git diff` do arquivo voltou ao que era; ao final a árvore só tem as correções e testes desta revisão.

Total: os 12 grupos do roteiro, com 91 mutantes distintos (57 no backend dos grupos 1 a 9 e 11, 26 de parser, matcher e motor no grupo 10, 8 do frontend no grupo 12). Primeira rodada: 81 mortos (2 deles por erro de compilação do próprio mutante, refeitos depois), 9 sobreviventes reais e 1 equivalente. Depois dos testes novos: 0 sobreviventes reais.

| Grupo | Mutantes (resumo) | Resultado |
|---|---|---|
| 1 userId | outro userId na gravação de conta fixa e de parcelado (núcleo, vale para tela e bot), no motor (2) | todos mortos |
| 1 userId (fuso) | `user.findUnique` com outro id na conta fixa (1e) | **sobreviveu**; teste novo "lê o fuso e confere o plano só do dono informado (bot e tela)" nos dois serviços; morto |
| 2 plano | sem `assertCanCreate` no núcleo (conta fixa e parcelado) e ao abrir o rascunho (motor) | todos mortos |
| 3 data | sem `notBefore`, `<=` no lugar de `<` (conta fixa e parcelado), motor chamando sem regras (2) | todos mortos |
| 4 parcela mínima | mínima 0, só a comum, só a última (4c), `floor`, última sem sobra, recibo com última igual | 4c **sobreviveu** (R$ 0,02 em 60: comum arredonda a 0 e a última absorveria tudo); teste novo `conversation-write.types.spec.ts` (tabela e propriedade sobre 20 totais x 59 quantidades); morto |
| 5 commit desconhecido | restaurar, liberar `appliedKey`, `isWriteUncertain` sem cada domínio, `callbackFinished` removido ou nunca marcado (8) | todos mortos |
| 6 falha pós-commit | materialização ou `touchUserData` propagando (4); motor perdendo cada aviso (4) | 6f (parcelado perdia aviso de materialização) **sobreviveu**; dois testes novos no motor; 6g e 6h tinham sido escritos com erro de compilação, refeitos; todos mortos |
| 7 recibo | recibo dependendo de `findOwned` ou de `toXResponse` (conta fixa e parcelado) | 7b e 7d (parcelado) **sobreviveram**; teste novo "o recibo não depende de leitura posterior" no parcelado; mortos |
| 8 revisão | sem subir a versão, restauração fingindo sucesso com outro rascunho aberto, sempre AWAITING, estado e TTL da restauração, data velha mantida, motivo da revisão preso (7) | todos mortos |
| 9 confirmação | sem `AWAITING_CONFIRMATION`, sem reivindicação, `appliedKey` aleatória, reivindicação sem versão (4) | todos mortos |
| 10 parser e matcher | frequência removendo palavra do meio, `12x de 100` como total, faixa 2 a 60 (2), `<=` na data, teto de 3 anos, sem teto, "primeiro curso", conectores, 21 palavras, data com várias palavras, abertura com data estranha, divisão não conferida (3), faixa da resposta, aviso de hoje, aviso de vencidos, última parcela, frequência fixa (26) | 10j, 10m, 10n, 10p **sobreviveram**; 4 testes novos (parser, matcher x2, motor); mortos. 10v: equivalente, ver abaixo |
| 11 escrita presumida | INCOME, crédito presumido, categoria presumida, pagamento presumido, frequência padrão, grava a parcela como total (6) | todos mortos |
| 12 frontend | etiqueta Criado em `transactionId`, sem Criado no parcelado ou na conta fixa, todo DONE Criado, turno sem dados, dois rótulos de campo, erro rotulado Lançado (8) | todos mortos por asserção (conferido com saída do Karma, não só código de saída) |

**Mutante equivalente (10v):** na conta fixa, `pendingField = nextRecurringPending(draft)` depois de responder o vencimento vira `null`. Equivalente porque o vencimento é o último campo da ordem (descrição, valor, vencimento); quando ele é respondido, os outros dois já estão preenchidos. No parcelado a ordem é igual e o código é igual; não é risco.

Testes adicionados nesta revisão: 26 no backend (607 para 633 nos três módulos) e 2 no frontend (270 para 272, os dois do bug do campo de um caractere).

## Integração real

Infra descartável: Postgres 16 em `127.0.0.1:55459` e Redis em `127.0.0.1:56409` (`docker run --rm`), banco novo `lumen_3b2b_review`, `prisma migrate deploy` com todas as migrations e `prisma migrate diff` "No difference detected". Backend real (dist) em `3999` com bootstrap de teste fora do repositório (`scratchpad/r3b2b/integ/boot.js`: relógio simulado, falha injetada na transação, na materialização e no `touchUserData`), billing ligado só ali, front estático em `4399`. Os scripts rodam com `TZ=UTC` (o cliente `pg` lê `timestamp` sem fuso como hora local; com `TZ` de São Paulo, três verificações de TTL e de data falhavam por defeito do script, não do código; confirmado e removido).

| Passo | Resultado | Onde |
|---|---|---|
| Duas contas A e B no plano Grátis | passou | `scn_a`, `scn_g` |
| Conta fixa hoje: 1 regra, 1 lançamento, `nextDueDate` avançou, DONE com id | passou | `run2_a.out` |
| Conta fixa futura: sem lançamento; mensal dia 31 (31/12, 31/01, 28/02, 31/03, âncora volta a 31) | passou | `run2_a.out`, `run2_g.out` |
| 3 contas ativas passam; 4ª recusada ao abrir com a mensagem do plano, sem rascunho | passou | `run2_a.out` |
| Plano cheio ao CONFIRMAR (a tela ocupa a última vaga entre abrir e confirmar): ERROR com a mensagem do domínio, nada gravado, sessão IDLE, evento sem `appliedKey`, reconfirmar = 404 (conta fixa e parcelado) | passou | `scn_h` |
| Parcelado: divisão exata e com sobra, 1ª parcela hoje, 3º parcelado recusado ao abrir | passou | `run2_b.out` |
| R$ 1,00 em 60 recusado no bot e em `POST /installments` (400); nada gravado | passou | `run2_b.out` |
| Bateria de divisão pela tela, cartão = banco = soma exata: 0,02/0,03/0,05 em 2; 0,60 e 0,61 em 60; 1 em 50; 10 em 3; 100 em 3; 1200 em 12; 33,35 em 7; 999.999,99 e 1.000.000,00 em 60; 99.999.999,99 em 60 (acima do teto do bot, só tela) | passou | `run2_b.out` |
| 6 confirmações em paralelo (botão): exatamente 1 cadastro (conta fixa e parcelado) | passou | `run2_a.out`, `run2_b.out` |
| Botão e texto "confirmar" em paralelo (3 botões + 3 textos): 1 DONE, 1 compra, 1 parcela | passou | `run2_g.out` |
| Mesmo `messageId` em 6 requisições paralelas: uma sessão, nenhum 500 (as repetidas respondem "há um rascunho em andamento"; a repetição sequencial responde DUPLICATE) | passou | `run2_g.out` |
| Cancelar não grava; recarregar com rascunho aberto restaura (mesmo id e versão), conta fixa e parcelado, em coleta e em confirmação | passou | `run2_a.out`, `run2_g.out` |
| Isolamento A/B: A confirma e cancela rascunho de B = 404 igual ao inexistente, sem vazar a descrição de B; rascunho de B intacto; B confirma o seu; A e B só veem as próprias regras e compras | passou | `run2_a.out`, `run2_g.out` |
| Corrida tela e bot na mesma conta do mesmo usuário: duas regras distintas, sem erro | passou | `run2_g.out` |
| Falhas controladas (conta fixa e parcelado): falha antes de gravar restaura o rascunho e a nova confirmação grava 1; ack perdido (commit real) e rollback depois do callback = ERROR/IDLE, sem restaurar, `appliedKey` mantida, reconfirmar 404, "confirmar" por texto não regrava; materialização falhando = DONE com aviso, 1 registro, sem novo rascunho, próxima leitura da tela materializa; `touchUserData` falhando = DONE com aviso; ambas = vale o aviso de lançamentos | passou | `run2_c.out` |
| Relógio simulado cruzando a meia-noite local em UTC, São Paulo e Tóquio: não grava, versão +1, volta a coleta de 15 min, "Atenção" no cartão, `GET /conversation/session` com `reviewReason`, versão antiga 404, nova data confirma e grava | passou | `run2_d.out` |
| Data: ano omitido sem saltar, 05/12 usa o ano atual, teto de 2 anos (16/11/2028 sim, 17/11/2028 não), 29/02/2027 inválido, ontem recusada, amanhã e ISO pedem data completa, primeiro dia do mês | passou | `run2_e.out` |
| Telas: `GET`/`POST` de `/recurring-transactions` e `/installments` com as mesmas chaves de resposta; descrição `"  a  "` = 400; INCOME semanal e vencimento passado até o mês anterior continuam aceitos; 3º parcelado pela tela = 403 do plano | passou | `run2_e.out` |
| Parser: lote de 119 frases (`scratchpad/r3b2b/parser-batch.out`) | passou, com duas leituras a registrar abaixo | feito pelo revisor anterior |
| Logs do backend: só `operation` e `errorName`; nenhuma descrição, valor ou frase de usuário | passou | `integ/backend.log` (466 linhas, conferido por busca das descrições usadas) |

Do lote do parser, nenhuma frase de conversa livre virou escrita nova. Dois casos que viraram rascunho são aceitáveis e estão registrados: `criar conta  fixa` (espaço duplo) é o prefixo explícito e abre a coleta; `criar conta fixa 120 internet mensal primeiro 20/11/2026 a a a a a a a a a a` (18 palavras) mantém "internet mensal primeiro 20/11/2026 a a ..." como descrição, porque o sufixo de data só vale no fim da frase; o cartão mostra a descrição e o usuário vê antes de confirmar.

## Chrome (front real contra o back de teste)

Puppeteer-core de fora do repositório, Chrome 148 headless, front estático com o build atual (já com a correção), nos temas claro e escuro, 390 px (com toque) e 1280 px, 4 combinações; 22 verificações por combinação, 88 no total, 0 falhas na última rodada. Capturas (e o log de cada rodada `log-<tema>-<largura>.txt`) em `/tmp/claude-1001/-home-caminhao-coding/bd9c9413-cf71-4265-8b29-e861b90c2685/scratchpad/r3b2b/caps/`: 113 imagens (cartão e página inteira por estado). Abri e olhei as de conta fixa completa, parcelado completo (escuro, 390), parcelado depois das respostas (escuro, 390), restaurado com campo pendente (claro, 390), revisão após recarregar (claro, 1280), erro de commit desconhecido (escuro, 1280) e parcelado criado (claro, 1280).

O que foi verificado e visto:

- Conta fixa completa: 8 linhas (duas "Aviso"), botões Confirmar e Cancelar com 44 px de altura, sem overflow horizontal (`scrollWidth` = `innerWidth`), tema aplicado.
- Foco por teclado: contorno sólido de 2 px no botão; Enter no botão Confirmar grava e a etiqueta vira "Criado".
- Parcelado completo: 10 linhas (duas "Aviso"); depois de confirmar, etiqueta "Criado" e texto "Compra parcelada criada: geladeira, total R$ 1.200,00 em 12 parcelas...".
- Campo pendente (valor da conta fixa, quantidade do parcelado): pergunta certa, linhas "a informar". Recarregar com rascunho aberto restaura o cartão com "Falta informar: valor." Responder "3" e a data leva à confirmação com R$ 300,00 por parcela (depois da correção do bug acima).
- Recarregar depois de DONE: o turno manual some (só o formulário e o histórico), como o contrato pede.
- Revisão por data passada (meia-noite de São Paulo simulada): linha "Atenção" com o motivo e "Primeiro vencimento: a informar"; depois de recarregar, o cartão volta com a mesma linha e "Falta informar: primeiro vencimento".
- Erro de commit desconhecido: etiqueta "Erro", texto "Não foi possível confirmar o resultado. Confira a tela de Finanças...", sem Confirmar nem "Tentar de novo".
- Sem `console.error`, `console.warn` nem `pageerror` da aplicação.

Observações visuais (não são defeitos do 3b2b): em 390 px, a barra inferior fixa do app cobre o fim do cartão na captura de elemento, como em qualquer página longa do app; no teste real, rolar a página resolve. Enter dentro da caixa de pergunta insere quebra de linha (comportamento anterior ao 3b2b, igual para todas as perguntas); Enter só ativa botões focados.

## Comandos finais (com a árvore corrigida)

- Backend `npx tsc --noEmit`: limpo.
- Backend `npx jest`: 48 suites, 1188 testes verdes (antes: 47 e 1162).
- Backend `npx nest build`: ok.
- Conversation, recurring-transactions e installments em `TZ=UTC`, `America/Sao_Paulo` e `Asia/Tokyo`: 14 suites e 633 testes verdes em cada um.
- Frontend `ng test --watch=false --browsers=ChromeHeadlessCI`: 272 verdes. `npm run build`: ok.

## Escopo

Arquivos alterados nesta revisão (todos testes, exceto os três do frontend):

- `backend/src/conversation/conversation.service.spec.ts`, `parsers/intent.matcher.spec.ts`, `parsers/write-body.parser.spec.ts`
- `backend/src/installments/installments.service.spec.ts` e o novo `backend/src/installments/conversation-write.types.spec.ts`
- `backend/src/recurring-transactions/recurring-transactions.service.spec.ts`
- `frontend/src/app/features/assistant/assistant-page/assistant-page.component.{ts,html,spec.ts}`

Nenhum arquivo de produção do backend foi alterado. Nenhum `package*.json`, `.env`, `environment*.ts`, schema, migration, DTO ou rota foi tocado. O contrato não mudou.

## Limites conhecidos e o que NÃO foi verificado

- **Lint:** o repositório não tem configuração de ESLint e o pacote `@typescript-eslint/parser` em `backend/node_modules` está vazio (instalação quebrada), então não consegui rodar ESLint nem com configuração temporária. Substituí por `tsc --noEmit --noUnusedLocals --noUnusedParameters` nos arquivos do 3b2b: duas importações sem uso, **ambas anteriores ao 3b2b** (`BadRequestException` em `conversation.service.ts` e `addDaysUtc` em `recurring-transactions.service.ts`). Não mexi (fora do escopo, trivial).
- Dispositivo móvel real e WhatsApp: não verificados (WhatsApp está fora do contrato).
- Perda real de conexão no commit: simulada por bootstrap (callback termina e o "ack" é descartado, ou o callback termina e a transação é revertida). Uma queda real do Postgres no meio do commit não foi provocada de propósito para não derrubar serviço.
- O teste de "mesmo `messageId` em paralelo" mostra que as requisições concorrentes repetidas respondem "há um rascunho em andamento" em vez de DUPLICATE; é o comportamento do item 2, sem duplicar gravação. Não mudei.
- Janela já documentada de queda entre reivindicar o rascunho e aplicar a ação continua existindo (contrato 3, não corrigida por este recorte).
- Mutantes cobrem os 12 grupos do roteiro com variantes extras; não rodei mutação exaustiva em todo o motor.
- Falta o `graphify update .` e o `ponytail-review` do agente principal.

## Limpeza

Contêineres `lumen-3b2b-rev-pg` e `lumen-3b2b-rev-redis` removidos (`--rm`); backend (3999) e front estático (4399) encerrados; Chrome encerrado; portas 3999, 4399, 55459 e 56409 sem listener. As portas 55439, 5432, 6379, 5433, 6380 e 3001 não foram usadas nem tocadas. Usuários de teste existiam só no banco descartável. `git status`: só os arquivos listados acima, mais `.superpowers/sdd/conversa-item-3b2b/retomada-revisao.md` (do agente principal) e este arquivo.
