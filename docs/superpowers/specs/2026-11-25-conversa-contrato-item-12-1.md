# Contrato 12.1: navegacao por menu em botoes (Telegram) e saida universal

Data: 2026-11-25. Estado: PROPOSTA para aprovacao do dono. Item 12 (fases em 2026-11-25-item-12-bot-v2-fases.md); visao geral em 2026-11-25-conversa-contrato-menu-hibrido.md.

## 1. Objetivo
Usuario navega por botoes (menu -> area -> operacao -> resultado) ou fala direto, e cada resultado ensina a frase de atalho. "voltar", "sair", "menu" e afins sempre levam ao menu inicial. Sem tabela nova e sem migration.

## 2. Arvore do menu (so o que o bot ja sabe fazer hoje; Tarefas e Avisos/Conta entram nas fases 12.2 e 12.3 e ficam ESCONDIDOS ate la)
- Inicio: Saldo | Resumo do mes | Gastos do mes | Proximos vencimentos
- Financas: Lancar despesa | Lancar receita | Gastos por categoria | Reservas | Contas fixas | Parcelados | Editar lancamento | Apagar lancamento
- Cartao: Meus cartoes | Limite e fatura | Definir limite | Limpar limite | Criar cartao | Renomear cartao
- Metas: Minhas metas | Criar meta | Guardar numa meta | Editar meta | Apagar meta
- Ajuda: o que sei fazer, com exemplos de frases naturais
Importar: fora (12.9). Selah e Configuracoes: fora (decisao do dono).

## 3. Como funciona (decisoes tecnicas, dono pode vetar)
1. **Arvore em um so lugar**, independente de canal (conversation/menu.tree.ts): nos com id, titulo, filhos, acao e frase de exemplo. O canal so desenha: Telegram = botoes inline; WhatsApp (futuro) = lista numerada em texto.
2. **Telegram**: navegacao por botoes INLINE (callback_query), a mensagem do menu e EDITADA no lugar (sem poluir o chat); cada submenu tem "Voltar" e "Menu". Mais um teclado fixo de resposta com um unico botao "Menu", sempre visivel. Os botoes Confirmar/Cancelar do rascunho continuam como hoje (teclado de resposta temporario); depois da confirmacao o teclado fixo volta.
3. **Sem estado no servidor para navegar**: cada botao carrega seu proprio destino (callback_data = id de no da arvore, ate 64 bytes). O id e conferido contra a arvore; id desconhecido e ignorado. O dono vem so do vinculo chat -> usuario, nunca do callback.
4. **Operacao de leitura** (saldo, resumo, gastos, vencimentos, cartoes, metas, reservas...): o botao executa a mesma frase do motor e responde o resultado.
5. **Operacao de escrita** (lancar, criar, editar, apagar, definir limite...): se o motor ja pergunta o campo que falta com o corpo vazio (ex.: "gastei" sem valor), o botao abre esse rascunho guiado; senao responde a instrucao com a frase pronta ("Para criar um cartao, diga: criar cartao Nubank"). Toda escrita continua com rascunho + confirmacao + recibo; botao nunca grava direto.
6. **Dica de atalho**: todo resultado obtido por botao termina com "Dica: da proxima vez, e so dizer: <frase natural>". Sem armazenamento (a limitacao por usuario vem na 12.5).
7. **Ajuda** passa a listar, por area, 2 a 3 exemplos naturais (inclui as perguntas da 12.0) e lembra que da para falar direto.
8. Comandos do Telegram: /menu e /start abrem o menu; os atuais (/saldo, /gastos, /cartao, /cartoes, /ajuda) continuam.

## 4. Saida e voltar (WhatsApp e Telegram, por texto)
- Palavras que saem (frase inteira, comparacao sem acento e caixa; ate 4 palavras): cancelar, cancela, parar, voltar, sair, desistir, deixa pra la, deixa quieto, esquece, chega, menu, inicio, comecar, start.
- Com rascunho aberto: cancela o rascunho (mesmo texto de hoje) e mostra o menu inicial.
- Sem rascunho: "voltar", "sair", "menu", "inicio", "comecar" mostram o menu inicial; "cancelar" sem nada aberto responde "Nada para cancelar." e mostra o menu.
- Nao entram: "nao" e "ok" sozinhos (continuam sendo resposta dentro dos fluxos). Palavra de saida so vale como frase inteira, nao no meio de outra frase.
- Dentro de submenu, o botao "Voltar" sobe UM nivel; "Menu" vai ao topo.

## 5. Registro de uso (para a 12.5)
Cada abertura de menu e cada acao por botao grava ConversationEvent com intent (ex.: menu_open, menu_nav:<no>, ou a intencao da acao) e resultado, SEM texto. Nenhuma coluna nova.

## 6. Testes e verificacao
- Unitarios: arvore (ids unicos, ate 64 bytes, nenhum no sem acao ou filhos), saida (todas as palavras, com e sem rascunho, nao vazar para frases normais), formatador Telegram (inline e fixo), adaptador (callback valido, invalido, de chat desvinculado, duplicado, mensagem editada que sumiu).
- Integracao real descartavel com Bot API FALSA local: navegar menu -> submenu -> operacao de leitura; operacao de escrita guiada e por instrucao; voltar e sair com e sem rascunho; escrita desligada (TELEGRAM_WRITES_ENABLED=false) nao grava; isolamento A/B/C (callback de um chat nunca age no usuario de outro).
- Mutantes >= 15, 3 fusos, suite inteira, testes novos 15x.
- NAO verificavel aqui: Telegram real (botoes inline e teclado fixo em celular), WhatsApp real.

## 7. Fora do escopo
Tarefas, Avisos, Conta, lacunas de Financas/Cartao/Metas (12.2 a 12.4); preferencias por usuario (12.5); embedding (12.6 a 12.8); WhatsApp (arvore ja pronta para ele); redesenho de Importar.

## 8. Decisoes para o dono (padrao entre parenteses; so responda o que quiser mudar)
1. Botoes inline com a mensagem editada no lugar + botao fixo "Menu" (padrao: sim).
2. Operacao de escrita sem guia do motor responde a instrucao com frase pronta, em vez de montar pergunta nova (padrao: sim; guia completo vira melhoria depois).
3. Emoji so no nome das areas (padrao: sim).
4. Dica de atalho em todo resultado por botao ate a 12.5 limitar (padrao: sim).
