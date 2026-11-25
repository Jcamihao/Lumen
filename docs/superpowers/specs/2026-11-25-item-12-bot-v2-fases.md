# Item 12: bot v2 (menu hibrido e aprendizado) — fases e tracking

Criado em 2026-11-25. Contrato: docs/superpowers/specs/2026-11-25-conversa-contrato-menu-hibrido.md. Canal inicial: Telegram (WhatsApp depois). Atualize a coluna Estado a cada merge.

| Fase | Entrega | Depende de | Estado |
|---|---|---|---|
| 12.0 | Perguntas naturais de leitura ("como esta o meu saldo?") | — | FEITA (v1.22.0, dc52a28) |
| 12.1 | Navegacao: menu em botoes no Telegram (Inicio, Tarefas, Financas, Cartao, Metas, Avisos, Conta, Ajuda), sair/voltar/menu/inicio universal, dica de atalho depois de cada operacao, ajuda com exemplos naturais | contrato da navegacao aprovado | a fazer (proximo) |
| 12.2 | Tarefas no bot: criar, listar, concluir, editar, apagar | 12.1 | a fazer |
| 12.3 | Avisos (lembretes e alertas) e Conta (plano so consulta, feedback) | 12.1 | a fazer |
| 12.4 | Lacunas: Inicio (insights, previsao), Financas (categorias, lancamentos recentes), Cartao (padrao, arquivar), Metas (retirar, historico de aportes) | 12.1 | a fazer |
| 12.5 | Preferencias por usuario: contador usuario+intencao (sem texto) ordena os botoes | 12.1 | a fazer |
| 12.6 | Curadoria manual: consentimento, texto mascarado, retencao, exclusao LGPD, tela admin | decisoes da fase 4 (texto, consentimento, 180 dias) | bloqueada pelo dono |
| 12.7 | Selah: provedor de embeddings, SQLite (catalogo + exemplos aprovados), POST /classify, /examples, /embeddings; atualizar handoff do Selah (excecao ao "stateless") | 12.6 (exemplos), contrato Selah | a fazer (repo SelahIA) |
| 12.8 | Lumen: cliente do Selah, faixas de similaridade (0,85 inicial), botoes "Voce quis dizer: X?", aprendizado com a resposta | 12.6, 12.7 | a fazer |
| 12.9 | Importar no bot | redesenho da logica/tela de Importar | fora desta rodada |

Regras do item: matcher por regras sempre primeiro; escrita nunca por similaridade; Selah/Configuracoes fora do menu; Plano so consulta; Selah guarda conhecimento (catalogo e exemplos aprovados mascarados), Lumen guarda dado pessoal; um subagente por vez (haiku implementa, sonnet revisa); conferencia independente e merge --no-ff na develop com handoff.
