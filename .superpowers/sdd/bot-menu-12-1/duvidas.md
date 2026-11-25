# Duvidas e limitacoes aceitas: 12.1a (motor do menu e saida universal)

Data: 2026-11-25. Branch feat/bot-menu-12-1.

## Limitacao aceita

1. **Palavra de saida como valor de campo.** Com rascunho em coleta, "chega" (e as demais palavras de saida) cancela o rascunho. Se um campo legitimo tiver esse texto, por exemplo categoria chamada "Chega", o usuario precisa digitar outra coisa. Aceito pelo contrato (secao 4). Se incomodar, a saida pode deixar de valer em campos de texto livre.

## Decisoes tomadas dentro do contrato (dono pode vetar)

2. **Folhas de escrita.** Usam frase (abre rascunho guiado) so onde o motor ja pergunta o campo que falta com o corpo vazio: "gastei" (despesa), "recebi" (receita), "criar meta", "definir limite". As demais escritas (criar cartao, renomear, limpar limite, editar/apagar, guardar em meta) respondem a instrucao com a frase pronta. Verificado por teste: "guardar" sozinho nao abre rascunho.
3. **Emoji nos titulos das areas.** Padrao do contrato (decisao 3). Adotado: "🏠 Início", "💰 Finanças", "💳 Cartão", "🎯 Metas", "❓ Ajuda".
4. **Ajuda como folha da raiz.** "Ajuda" e uma folha com a frase "ajuda", nao uma area com filhos. O contrato lista Ajuda ao lado das areas, entao a forma foi mantida simples.
5. **Saida sem rascunho e navegacao.** Sem estado no servidor, "voltar" sem rascunho sempre vai ao menu inicial (nao sobe um nivel). O "Voltar" de um nivel e do botao, na 12.1b.
6. **Evento de navegacao.** Abertura de menu grava menu_open; navegacao de area grava menu_nav:<id>; folha de frase grava so o evento da propria acao (o messageId e unico por usuario e canal, entao um evento por clique). Folha de instrucao grava menu_nav:<id>.

## Pendencias para a 12.1b (nao decidir aqui)

7. Telegram: como desenhar o kind MENU (botoes inline, editar a mensagem) e o teclado fixo "Menu" ficam no adaptador da 12.1b. Hoje o Telegram so imprime o texto do MENU.
