# Resultado 9c-1c: limpar teto por cartao (rota + tela)

Data: 2026-11-24. Branch: feat/cartoes-telas-9c (nao trocada). Executor: agente Haiku 5.5. Revisao sonnet e conferencia do agente principal: pendentes.

## Mudancas
- Backend `DELETE /credit-cards/:id/ceiling` (commit 56907fa): `CreditCycleService.clearCeiling` concentra a regra e o lock do limpar teto; `removeCeilingForConversation` (bot) e `clearCeilingForCard` (tela) usam o mesmo nucleo. Ordem de locks: User -> cartao -> teto. Recibo: `cardId, id, removedCents, cycleStart, cycleEnd, refreshPending`. Sem teto vigente: 409 "Nao ha teto neste ciclo para limpar. Atualize a tela.". Arquivado: 409. Alheio/inexistente: 404. Queda depois do delete: resultado desconhecido (500 sem repetir). Swagger atualizado. Sem schema/migration.
- Testes backend (commit ea939f2): 5 casos novos em credit-cards.service.spec.ts + linha de isolamento A/B/C para DELETE.
- Frontend: `LifeApiService.clearCreditCardCeiling`; `clearCeilingMessage` em credit-card.utils.ts; botao "Limpar teto" no card do ciclo (so com teto, online e 2+ cartoes ativos; vale em qualquer aba, inclusive a do padrao); confirmacao em 2 etapas (Confirmar/Cancelar, Esc cancela); "Limpando..." com botao desligado; 404 e 409 com texto proprio; 5xx e status 0 = resultado desconhecido, Confirmar desligado, sem nova tentativa; recarrega o ciclo apos sucesso.

## Comandos e numeros
- `cd backend && npx tsc --noEmit`: OK.
- `cd backend && npx jest src/credit-cards src/credit-cycle src/conversation src/telegram --maxWorkers=2` em TZ=UTC, America/Sao_Paulo e Asia/Tokyo: 34 suites, 1177 testes, todos passam nos 3 fusos.
- `cd frontend && npx ng build`: OK.
- `cd frontend && npx ng test --watch=false` (Chrome headless com libs extraidas em pasta do scratchpad, apagada no fim): 531 SUCCESS, 0 FAILED nos 3 fusos (antes 517; +14).
- `graphify update .`: OK.

## Mutantes
Backend (8, um por vez, restaurados): B1 sem guarda de teto ausente; B2 arquivado liberado; B3 sem marca de commit; B4 sem lock do User; B5 snapshot do rascunho ignorado (bot); B6 removedCents zerado; B7 conflito vira 500; B8 dono nao checado no clear. Mortos: 8/8. Sobreviventes: 0.
Frontend (11, um por vez, restaurados): F1 Confirmar nunca aparece; F2 Esc nao cancela; F3 5xx nao vira desconhecido; F4 Cancelar durante envio permitido; F5 segundo envio permitido; F6 sem recarregar; F7 botao aparece offline; F8 botao com 1 cartao; F9 botao sem teto; F10 404 sem texto proprio; F11 botao nao desligado durante envio.
- Primeira rodada: F4 e F5 sobreviveram (a UI desliga o botao, so o metodo expunha a falta). Dois testes de metodo adicionados: F4 e F5 mortos.
- Final: 10 mortos de primeira + F4/F5 depois = 12 mortos (frontend), 0 sobreviventes, 1 equivalente: F8 (o bloco inteiro ja some com 1 cartao pelo ngIf de canEdit, entao a condicao extra nao muda a tela).
- Total: 20 mutantes, 19 mortos, 0 sobreviventes, 1 equivalente. (Frontend 11 mutantes: 10 mortos de primeira ou depois, F4/F5 mortos apos testes novos, F8 equivalente.)

## Decisoes de implementacao
- Sem teto vigente: 409 (segue o motor do bot, que trata como conflito). Nao virou 200 idempotente.
- Texto do 409 de arquivado segue o PUT ("Cartao arquivado nao tem teto para limpar.").

## NAO verificado
- Chrome real contra backend real (Postgres/Redis descartaveis): nao feito nesta fatia. Frontend testado so com mock do LifeApiService.
- DELETE contra Postgres real: so no banco em memoria dos testes (mesmo fake de 9c-1b).
- Swagger renderizado: nao abri a UI, so o decorator.
- Visual em 390 px e 1280 px, claro e escuro, teclado e leitor de tela do botao novo.
- Intermitencia (suite 15 ou 30 vezes): nao feita; uma rodada por fuso.
- Backend: so credit-cards, credit-cycle, conversation e telegram; suite inteira nao rodada.
- Revisao sonnet (com Chrome real e mutantes do revisor): pendente.
- Limpar teto por cartao com a conversa do bot ponta a ponta: nao testado.
