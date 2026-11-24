# Resultado da revisao 9c-1a (tela de Cartoes)

Data: 2026-11-24. Revisor: Claude Sonnet 5.5. Branch feat/cartoes-telas-9c (nao trocada). Sem push.

## Veredito
APROVADO com 1 defeito corrigido (Esc) e 7 testes novos de guarda. Nenhum defeito funcional nem de layout nos fluxos reais. Duvidas de produto abaixo.

## Achados
1. DEFEITO (corrigido): Esc nao fechava o formulario nem cancelava a confirmacao de arquivar (brief pede Tab/Enter/Esc). Fix f5914ea (html), teste 2185d15.
2. Sobreviventes reais de mutantes (guardas que a UI esconde): cobertos em 7 testes novos (commit "test(cartoes): cobre guardas de modelo...").
3. Duvida de produto: Esc em campo de formulario descarta o que foi digitado sem confirmar (como o botao Cancelar).
4. Duvida de produto (ja em duvidas.md): sem cache offline da lista; texto do 422; teto/escopo duplicados na tela.
5. Observacao: ao arquivar o padrao anterior o app exige antes tornar outro padrao (ok); arquivar o antigo Principal apos trocar funcionou e o arquivado nao tem acoes.
6. Observacao: a tela tem 2 botoes "Tentar de novo" (lista e ciclo); cada um recarrega so o seu bloco (comportamento esperado, nao defeito).

## Verificacao real (2026-11-24)
Ambiente: Postgres 16 e Redis 7 descartaveis (rv9f-pg porta 15432, rv9f-redis porta 56379), banco novo com todas as migrations, backend nest build em 13000, ng serve em 14200, Chrome headless real (puppeteer-core 148) com libs de sistema extraidas em pasta propria. Contas A e B.
- Login; Cartoes; lista inicial: Principal com selo Padrao, "Fecha dia 10 - sem vencimento", Arquivar desabilitado com "Torne outro cartao padrao antes de arquivar." OK.
- Criar Nubank (25/5): POST 201, aparece na lista. Banco conferido.
- Nome repetido "nubank": POST 409, texto "Ja existe um cartao com este nome. Escolha outro." e campos preservados (nubank/12/9). OK.
- Fechamento 0, 32 e vazio; vencimento 32: erro "Use um dia de 1 a 31.", aria-invalid, 0 requisicoes. OK.
- Editar (nome, fechamento 25 para 20, vencimento apagado): PATCH 200; banco: Nubank Roxo 20/null. OK.
- Tornar padrao: selo muda; banco: isDefault trocou; User.monthClosingDay de A = 20 (sincronizado); ciclo do cartao padrao passou para 21/11 a 20/12. OK.
- Arquivar em 2 etapas: 1o clique so mostra "Confirmar arquivamento"/"Cancelar"; Cancelar sem requisicao; confirmar DELETE 200; banco archivedAt preenchido.
- Interruptor arquivados: GET ?includeArchived=true; arquivado marcado "Arquivado", 0 botoes. OK.
- Teto 10: A com 10 ativos (1 + 9 via API; 10o via API deu 422); botao "Novo cartao" desabilitado com "Voce ja tem 10 cartoes ativos. Arquive um para criar outro.". OK.
- Isolamento: B so ve o proprio Principal (tambem com arquivados); banco: A 10 ativos/11 total, B 1/1.
- Erro de rede (backend derrubado): "Nao foi possivel carregar seus cartoes" + "Tentar de novo"; com backend de volta, o botao recarrega 10 cartoes. OK.
- Antes da tela: teto do ciclo (PUT /credit-cycle/ceiling 1600 e PATCH settings countAllPayments true) seguem 200 e no banco; fechamento do padrao agora via PATCH do cartao.
- Teclado: Tab chega nos campos, Enter envia, Esc fecha novo e edicao (apos o fix; antes falhava).
- Screenshots lidas (390 e 1280, claro e escuro; teto 390 claro): sem texto cortado, sem sobreposicao, sem rolagem horizontal (overflowX 0, nenhum elemento alem da largura), tema trocado conferido via data-theme. Foco visivel: borda azul nos campos, contorno no checkbox. Nas capturas fullPage a barra inferior/menu aparece sobre o conteudo: artefato do fullPage com elemento fixo, nao e defeito.

## Mutantes proprios (22 injetados, um por vez, no componente, html e servico)
- Mortos de primeira (14): M1 teto 10->11; M5 toggle sem recarregar; M6 query includeArchived=1; M7 sync do padrao invertido; M8 sync sem recarregar ciclo; M9 sem texto 422; M11 404 virou 400; M14 nonBlank sem trim; M15 Arquivar do padrao habilitado; M20 Novo nao desabilita no limite; M21 sync nao atualiza usuario; M22 Esc nao cancela; M16 (apos refazer como GET; a 1a versao com POST nao compilou, inconclusiva).
- Sobreviventes reais (7), cobertos e agora mortos: M3 makeDefault sem guarda de padrao; M10 startEdit aceita arquivado; M12 submit sem guarda de salvando; M13 submit sem guarda offline; M17 checkbox invertido; M18 teto sem guarda de salvando; M19 confirmArchive sem guarda de ocupado.
- Equivalentes (2): M2 (dueDay sem Number: input type number ja entrega number); M4 (confirmArchiveId nao limpo apos arquivar: o cartao some/vira arquivado sem acoes, sem efeito visivel).
- Total: 22; mortos 20; equivalentes 2; vivos sem tratamento 0.

## Numeros (2026-11-24, conferido por Claude Sonnet 5.5)
- ng build --configuration development: OK.
- ng test --watch=false (suite inteira, TZ=UTC): 459 SUCCESS, 0 FAILED (antes 450; +2 Esc, +7 guardas).
- card-page spec sozinho: 49 SUCCESS.
- graphify update .: executado.
- Limpeza: containers rv9f-pg/rv9f-redis removidos (--rm), processos backend/ng encerrados por PID, libs e scripts de /tmp removidos; portas 13000/14200/15432/56379 sem listener. detect-objects e wa-akg-db seguem de pe. lumen-postgres-1 e lumen-redis-1 estavam parados (Exited 255 ha 22 horas) antes da revisao; nao foram tocados por mim.

## NAO verificado
- Offline real (navigator offline / airplane): so o sinal offlineMode em teste de unidade; offline real no navegador nao.
- Leitor de tela real; so labels/aria e foco por teclado.
- Build de producao (build:mobile) e app nativo (Capacitor).
- Intermitencia (suite 15/30 vezes) e outros fusos (esta rodada so TZ=UTC; a tela nao tem logica de data propria alem do ciclo).
- Cenario 422 pela tela (10o cartao pela UI): o botao fica desabilitado; o 422 foi visto so via API e em teste de unidade.
- Concorrencia entre duas abas/contas do mesmo usuario.
