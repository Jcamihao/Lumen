# Contrato (rascunho): menu hibrido do bot e perguntas naturais

Data: 2026-11-25. Estado: PLANEJAMENTO, nada aprovado. Canal inicial: Telegram (WhatsApp depois).

## 1. Objetivo
Usuario navega por menu em botoes OU fala direto. Cada operacao concluida ensina o atalho em frase natural. O sistema aprende o que cada usuario mais usa e, depois, forma base curada para ML.

## 2. Menu (espelha a sidebar do app, so o necessario)
Entram (decisao do dono, 2026-11-25): Inicio, Tarefas, Finanças, Cartao, Metas, Avisos (subitens: Lembretes, Alertas), Conta (subitens: Plano, Feedback), Ajuda. Nomes Avisos e Conta aprovados pelo dono (2026-11-25). Plano no bot e so consulta; mudar de plano fica no app (aprovado). Importar: depois do redesenho. Fora: Selah e Configuracoes (bot usa o que o usuario ja configurou no app).
Fluxo: Menu -> area -> operacoes da area -> operacao feita -> dica "da proxima vez, diga: <frase>".
Navegacao: "voltar", "sair", "menu", "inicio", "cancela", "desistir", "deixa pra la" funcionam em qualquer ponto, com ou sem rascunho; sair de rascunho cancela e mostra o menu. Hoje so cancelar/parar/voltar saem, e so com rascunho aberto.

## 3. Auditoria por area (app x bot hoje)
| Area | O app faz | O bot ja faz | Lacuna |
|---|---|---|---|
| Inicio | saldo, resumo do mes, vencimentos, insights, previsao | saldo, resumo, gastos, vencimentos | insights e previsao do mes |
| Tarefas | criar, listar/filtrar, concluir, editar, apagar, subtarefas, categorias, prioridade, recorrencia | NADA | area inteira (fatia propria) |
| Avisos | lembretes (criar/listar/editar/apagar), central de alertas (ler, marcar como lido) | NADA | area inteira |
| Conta | ver plano e limites, enviar feedback | NADA | consulta de plano e envio de feedback (mudar de plano fica no app) |
| Financas | lancar despesa/receita, editar/apagar, categorias, reservas, contas fixas, parcelados, ciclo do cartao | lancar, editar/apagar, reservas, contas fixas, parcelados, gastos por categoria | criar/editar categoria; listar lancamentos recentes |
| Cartao | listar, criar, renomear, padrao, arquivar, teto, ciclo/fatura | listar, ler, teto, criar, renomear | tornar padrao, arquivar (fora desde a 9b) |
| Metas | criar, aportar, retirar, historico de aportes, editar, apagar | criar, aportar, editar, apagar, listar | retirar, historico de aportes |

## 4. Fatias (ordem sugerida)
1. Perguntas naturais de leitura (EM REVISAO, branch feat/bot-perguntas-naturais).
2. Navegacao: menu em botoes no Telegram (teclado fixo), sair/voltar universal, dica de atalho apos cada operacao, ajuda com exemplos naturais.
3. Tarefas no bot (criar, listar, concluir, editar, apagar).
3b. Avisos (lembretes e alertas) e Conta (plano, feedback) no bot.
4. Lacunas de Financas, Cartao e Metas da tabela acima.
5. Preferencias por usuario: contador por usuario+intencao (sem texto) ordena os botoes do menu.
6. Curadoria e ML (fase 4): ver secao 5.

## 5. Fase 4 (depende de decisoes do dono)
- Guardar texto das mensagens (mascarar valores e nomes), so de quem consentir, com opcao de desligar, incluido na exclusao LGPD.
- Retencao sugerida: 180 dias para texto bruto; exemplo curado sem identificar a pessoa.
- Tela de curadoria: aprovar/corrigir exemplos antes de treinar.
- Embedding dos textos: gerado so pelo Selah, em fila (BullMQ), a partir do texto mascarado; trata como dado pessoal (mesma retencao/exclusao). Armazenamento: pgvector (exige trocar imagem do Postgres + migration) OU vetores no Selah.
- Busca por similaridade usa so exemplos curados e aprovados; nunca mensagens de outros usuarios.
- Matcher por regras continua primeiro; ML so decide o que as regras nao pegaram.

## 6. Decisoes abertas do dono
1. Fase 4: guardar texto? consentimento? retencao 180 dias? pgvector ou Selah?
2. (resolvida) Nomes Avisos/Conta e Plano so consulta: aprovados.
3. Duvidas da fatia 1 (hoje = total do mes; "quanto devo no X" = fatura).
