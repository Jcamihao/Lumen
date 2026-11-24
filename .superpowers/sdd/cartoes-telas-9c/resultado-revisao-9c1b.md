# Resultado da revisao 9c-1b (cartao nos lancamentos, filtro, ciclo por cartao, rascunhos, menu do Telegram)

Data: 2026-11-24. Revisor: Claude Sonnet 5.5. Branch feat/cartoes-telas-9c (nao trocada). Sem push.

## Veredito
APROVADO com 3 defeitos corrigidos (commits separados) e 3 sobreviventes de mutante cobertos. Nenhum defeito de layout. Duvidas de produto abaixo.

## Achados
1. DEFEITO (corrigido, 32c791c): Esc nao fechava o formulario do teto por aba (brief pede Tab/Enter/Esc). Esc durante o envio nao fecha.
2. DEFEITO (corrigido, 32c791c): backend derrubado (erro de rede, status 0) nao era "resultado desconhecido": Salvar continuava ligado e o PUT foi repetido (2 PUT). Agora status 0 e 5xx: texto "Nao sei se o teto foi salvo...", Salvar desligado, 1 PUT so (conferido no Chrome real).
3. DEFEITO pre-existente (corrigido, 28b8848): o menu do Telegram anunciava /saldo, /gastos e /ajuda, mas o motor respondia "Nao entendi" (so /cartao e /cartoes eram mapeados). Agora mapeados. Conferido com Bot API falsa.
4. Duvida de produto: com sem rede, as abas do ciclo continuam visiveis (so o botao de teto some); clicar numa aba offline mostra erro de carregar.
5. Duvida de produto: "/start" e "/cartao nubank" ainda caem em "Nao entendi" (fora do escopo).
6. Observacao: GET /credit-cards roda 3 vezes ao abrir Financas (seletor, filtro e ciclo, um por componente). Sem defeito; possivel cache futuro.
7. Observacao: lancamento no credito com 1 cartao grava cardId nulo (servidor usa o padrao); o ciclo conta (R$ 5,55 em /credit-cycle/current) e a lista nao mostra chip de cartao. Como previsto no brief.
8. Observacao: o rascunho de escolha de cartao mostra "Forma de pagamento: nao informado" enquanto pergunta o cartao (texto do motor, nao do front).
9. Observacao: nas capturas de elemento a barra inferior aparece sobre o conteudo (artefato do fixed; nao e defeito).

## Verificacao real (2026-11-24)
Ambiente: Postgres 16 (rv9g-pg, 15532) e Redis 7 (rv9g-redis, 56390) descartaveis, banco novo com todas as migrations; backend nest build em 13010; app Angular ng build servido em 14210; Chrome headless real (puppeteer-core 148) com libs extraidas em pasta propria; Bot API falsa em 18095. Contas: A (1 cartao), A2 (Principal, Nubank, Inter, depois Itau; Inter arquivado), B (2 cartoes proprios).
- Seletor (A2): aparece so com despesa+credito (some em receita, transferencia, PIX, debito, sem forma), padrao marcado; banco: Nubank escolhido gravou Nubank; padrao gravou Principal; escolher Inter e trocar para PIX enviou sem cardId; receita com credito sem cardId. Parcelado e conta fixa: cardId Nubank no banco; lista "Credito - Nubank".
- Conta A (1 cartao): sem seletor, sem abas, sem filtro, sem botao de teto; ciclo por /credit-cycle/current; POST sem cardId; ciclo contou o gasto.
- Listas: chip com cardName; filtro Todos/um cartao enviou cardId na URL e filtrou; "Todos" voltou sem cardId.
- Abas do ciclo: padrao primeiro e selecionado; texto da aba do padrao igual ao de /credit-cycle/current (resposta identica); com tetos 1000/500/750,55: restantes R$ 977,78 e R$ 488,89 e R$ 739,44 conferem (teto - gasto); banco confere (Nubank 750.55, Principal 1200.00).
- Teto: invalidos (0, -5, 1.234, vazio, 99999999999) sem requisicao e com texto; envio duplo = 1 PUT; 409 real (cartao arquivado pela API com aba aberta) mostra o texto; 404 e 400 simulados por interceptacao (nao ha como produzir 404 real pela tela); backend derrubado = resultado desconhecido, sem nova tentativa (apos correcao).
- Isolamento: B so ve os proprios cartoes; B em /credit-cards/:idDeA2/cycle e /ceiling = 404; B criar lancamento com cardId de A2 = 400. Arquivado (Inter) nao e oferecido (escolha do assistente listou Principal, Itau Azul, Nubank).
- Offline (setOfflineMode + evento): seletor some, botao de teto some; volta online e reaparecem.
- Assistente (chat do app, A2): "criar cartao Itau" -> pergunta fechamento -> "15" -> rascunho CARD_CREATE renderizado, Confirmar -> banco: Itau 15/sem vencimento/nao padrao; "renomear cartao Itau para Itau Azul" -> CARD_RENAME, Confirmar, banco confere; "gastei 30 farmacia no credito" -> categoria -> "Em qual cartao? 1) Principal 2) Itau Azul 3) Nubank" -> "2" -> Confirmar -> banco: cartao Itau Azul; recarregar a pagina com rascunho pendente mostra "Falta informar: dia de fechamento." e Cancelar funciona.
- Telegram (Bot API falsa): setMyCommands inclui cartoes "Meus cartoes"; /cartao -> resumo do ciclo do padrao; /cartoes e "/Cartoes " e "meus cartoes" -> lista dos 3 cartoes ativos; /saldo, /gastos, /ajuda respondem (apos correcao).
- Visual: 390 e 1280 px, claro e escuro (data-theme conferido), cartoes do ciclo (aba + formulario com erro), grade lancamento+lista com seletor e filtro, parcelado com seletor, rascunho do assistente: imagens lidas, sem corte, sem sobreposicao, scrollWidth - clientWidth = 0 em todas. Aba selecionada marcada so por sublinhado (legivel).
- Teclado: Tab chega nos controles, Enter envia o teto, Esc fecha (apos correcao).

## Mutantes proprios (23, um por vez, restaurados depois de cada um)
Frontend: M1 arquivados entram; M2 isCreditExpense so exclui receita; M3 pickCardId limiar 1; M4 cardIdForPayload sem checar credito; M5 teto aceita 0; M6 teto maximo x10; M7 5xx limiar 500 estrito; M8 404 vira 403; M9 status 0 nao e desconhecido; M10 abas com 1 cartao; M11 sem guarda de aba ja selecionada; M12 canEdit sem online; M13 cancelar sem guarda de envio; M14 sem handler de Esc; M15 ciclo com 1 cartao usa :id; M16 aba inicial = ultimo cartao; M17 filtro com 1 cartao; M18 filtro de cartao ignorado na lista; M19 seletor com 1 cartao; M20 seletor visivel offline. Backend: M21 /cartoes mapeado para "cartoes"; M22 sem /saldo; M23 sem /ajuda.
- Mortos de primeira: 20. Sobreviventes reais: 3 (M2 transferencia no credito, M6 limite maximo, M11 clique na aba ja selecionada), cobertos com 3 testes novos (48f72bb) e agora mortos. Equivalentes: 0. Final: 23 mortos.

## Numeros (2026-11-24, conferido por Claude Sonnet 5.5)
- ng build: OK. ng test --watch=false: 517 SUCCESS, 0 FAILED (antes 510; +7).
- backend npx tsc --noEmit: OK. jest src/telegram src/conversation em TZ=UTC, America/Sao_Paulo e Asia/Tokyo: 28 suites, 1038 testes, todos passam nos 3 fusos.
- graphify update .: executado.
- Limpeza: rv9g-pg e rv9g-redis parados (--rm) e removidos; servidor estatico, backend e Bot API falsa encerrados por PID; libs e scripts da pasta temporaria apagados; portas 13010/14210/15432->15532/56390/18095 sem listener. wa-akg-db segue de pe. detect-objects aparece "Exited (137)" ha ~16 min (antes de eu parar qualquer coisa; nao toquei nele, so parei rv9g-*); lumen-postgres-1 e lumen-redis-1 ja estavam parados ha 23 h. zealous_diffie (porta 8000, nome aleatorio) tambem sumiu da lista; nao era meu.

## NAO verificado
- Offline real do navegador/app nativo (so setOfflineMode + evento); build:mobile e app nativo.
- Leitor de tela; so labels, foco e teclado.
- 404 real do PUT do teto pela tela (so simulado por interceptacao); 400 idem.
- Intermitencia (suite 15/30 vezes) e fusos no ng test (so TZ do ambiente; a 9c-1b nao tem logica de data nova).
- Suite inteira do backend (so telegram e conversation).
- Telegram real (Bot API oficial): so a Bot API falsa.
- Selah/IA externa no assistente (SELAH desligado; so o modo manual).
- Limpar teto por cartao: fora do escopo (sem rota na API; aguarda decisao do dono).
