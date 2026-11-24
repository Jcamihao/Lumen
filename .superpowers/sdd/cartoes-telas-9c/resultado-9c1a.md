# Resultado 9c-1a: tela de Cartões no app

Data: 2026-11-24. Branch: feat/cartoes-telas-9c (não trocada). Executor: agente Haiku 5.5 (sem revisor sonnet nesta fatia; revisão fica para a etapa sonnet). Conferência independente: pendente do agente principal.

## Mudanças
- `core/models/domain.models.ts`: tipos `CreditCard`, `CreditCardReceipt`, `CreditCardInput`.
- `core/services/life-api.service.ts`: `listCreditCards(includeArchived)`, `createCreditCard`, `updateCreditCard`, `archiveCreditCard`, `makeDefaultCreditCard`. Escritas sem fallback offline (erro chega à tela).
- `features/card/card-page` (ts/html/scss): vira a lista de cartões. Criar, editar (nome, fechamento, vencimento), tornar padrão, arquivar em duas etapas, "Mostrar arquivados", teto de 10 (botão desabilita com texto), erros 400/404/409/422 em português com o texto digitado preservado, modo offline sem criar/editar. Abaixo, ciclo do cartão padrão (teto e escopo) mantido como estava. Fechamento do usuário local é atualizado quando o cartão editado vira padrão. Formulários de lançamento e o card do ciclo (9c-1b) não foram tocados. Backend não foi tocado.
- Specs: `card-page.component.spec.ts` (reescrito, 40 testes da tela), `core/services/life-api.credit-cards.spec.ts` (novo, 7 testes de URL e corpo).

## Comandos e números
- `cd frontend && npx ng build --configuration development`: OK (sem erro).
- `npx ng test --watch=false` (suíte inteira, TZ=UTC): TOTAL 450 SUCCESS, 0 FAILED.
- Specs novas com TZ=America/Sao_Paulo: 47 SUCCESS. Com TZ=Asia/Tokyo: 47 SUCCESS.
- Chrome: o headless do puppeteer não subia por falta de libs do sistema (libnspr4, libnss3, libasound2). Libs baixadas com `apt-get download` para a pasta de scratchpad e usadas por `LD_LIBRARY_PATH`. Nada instalado no sistema.
- `graphify update .`: OK (6244 nós, 13817 arestas).

## Mutantes (16 injetados, um por vez, nos arquivos da tela e do serviço)
- MORTOS na primeira rodada (12): M01 nome sem aparar; M02 sem validador de nome só com espaços; M06 arquivar em um clique (ver ruído abaixo); M07 teto com > em vez de >=; M08 arquivados contando no teto; M09 texto do 409 trocado; M10 formulário limpo no erro; M11 sincronia do usuário sem checar padrão; M12 criar liberado offline; M14 PATCH sem encodeURIComponent; M15 query includeArchived ignorada; M16 corpo do make-default errado.
- SOBREVIVENTES na primeira rodada (4), cobertos com testes novos: M05 (askArchive em cartão padrão ficava em confirmação, teste só olhava o botão da UI) -> teste do modelo; M13 (lista mostrava arquivado com o interruptor desligado) -> teste novo. Ambos morreram.
- M03 (fechamento sem max 31) e M04 (vencimento sem max 31): sobreviveram porque o atributo `max="31"` no HTML também valida o controle (Angular liga o validador da diretiva). Tratados como EQUIVALENTES na UI. Removendo também o atributo do HTML, 3 testes novos de modelo e de UI matam o mutante (3 FAILED). Testes de modelo ficam no spec.
- M06 (arquivar em um clique): morto (4 FAILED), mas o Karma desconectou por timeout (30 s) no meio da rodada, nas duas vezes. Causa do travamento não investigada; a falha vale, o ruído não.
- Equivalentes: M03 e M04 na forma isolada. Nenhum outro.
- Total final: 16 mutantes, 16 mortos (2 deles só com o atributo HTML também removido), 0 vivos sem tratamento.

## NÃO verificado
- Chrome real contra backend real (sem Docker nesta fatia; é da etapa sonnet/integração).
- Visual em 390 px e 1280 px, claro e escuro. Não rodei o app.
- Leitor de tela e navegação só por teclado: só labels/aria no código, sem teste de acessibilidade.
- Modo offline real (navigator offline): só simulado pelo sinal `offlineMode`.
- Build de produção (`build:mobile`): só o development.
- Suíte repetida 15-30 vezes (intermitência): não feita; as specs novas passaram em 3 rodadas de TZ.
- Teto da lista offline: não há cache de cartões; sem rede a tela mostra erro de carregar.
- Teto e escopo do cartão padrão continuam na tela (duplicam a parte de Finanças). Decisão em duvidas.md.
