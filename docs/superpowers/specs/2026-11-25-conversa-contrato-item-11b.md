# Contrato do item 11b: carteira compartilhada (PROPOSTA, aguarda decisões do dono)

Data: 2026-11-25. Base: develop com a 11a (grupo do plano Compartilhado: membros, convites, plano efetivo, 2 pessoas podendo evoluir até 4). Hoje **nenhum dado é compartilhado**: toda tabela de dados tem `userId` e toda leitura filtra por ele (29 tabelas com `userId`). A 11b muda isso, e é a mudança de maior risco do roteiro: **privacidade e isolamento vêm antes de qualquer tela**.

## 1. Princípio proposto
**Privado por padrão. Compartilhar é um ato explícito, por item, e sempre revogável.** O dado continua sendo de quem o criou (a regra "identidade vem do token, dado é do dono" não muda); o compartilhamento só dá ao outro membro do mesmo grupo **acesso ao item marcado**, e só enquanto o grupo e o plano Compartilhado estiverem ativos.

## 2. Decisões para o dono (recomendação em negrito)
1. **Modelo.** (a) uma carteira única do grupo, em que todos escrevem num livro comum e o dado pertence ao grupo; (b) cada um mantém o seu livro e **marca itens como "compartilhado"**; (c) o parceiro só lê. **Recomendo (b):** privacidade por padrão, sem migrar dado existente, e dá para entregar por fatias. A (a) exige migrar tudo para um dono "grupo" e quebra o isolamento atual.
2. **O que pode ser compartilhado, em ordem.** 11b-1: **lançamentos, categorias e cartões**. Depois (11c): metas, reservas (envelopes), contas fixas e parcelados. **Nunca compartilhados:** tarefas, lembretes, importações, conversa e histórico do assistente, vínculos do WhatsApp e do Telegram, sessões, dados do perfil e saldo total. **Recomendo esse corte.**
3. **Quem edita o item compartilhado.** **Recomendo: qualquer membro do grupo vê, edita e apaga os itens compartilhados**, com o autor registrado. Alternativa mais restrita: só o autor edita.
4. **Quem sai ou é removido.** **Recomendo: os itens compartilhados que ele criou voltam a ser privados dele** (somem da visão do outro) e o que o outro criou continua com o outro. O dado é de quem criou.
5. **Plano cai (`PAST_DUE`, `CANCELED`, `EXPIRED`).** **Recomendo: o compartilhamento pausa para todos** (cada um vê só o que é seu), nada é apagado, e reativar o plano retoma. Alinhado com a regra da 11a de que todos perdem o Compartilhado juntos.
6. **Totais, dashboard, insights e previsão.** **Recomendo um seletor "Meu / Compartilhado / Tudo", padrão "Meu"**, para o número de cada pessoa nunca mudar sem querer. O saldo total de cada pessoa **não é exposto** ao parceiro; só os itens marcados.
7. **Bot (app, WhatsApp, Telegram).** **Recomendo: o bot grava no pessoal por padrão** e só grava compartilhado quando você diz ("gastei 50 mercado compartilhado"). Cada canal continua pessoal: o parceiro não usa o seu vínculo. Sem aviso cruzado ao parceiro na 11b.
8. **Privacidade do parceiro.** O membro vê só o primeiro nome de quem criou o item compartilhado, nunca e-mail, telefone ou outros dados. **Recomendo.**
9. **Exportação e exclusão de conta (LGPD).** **Recomendo: cada um exporta o que criou (marcando quais itens estavam compartilhados) e, ao excluir a conta, os itens compartilhados criados por ele são apagados junto.** O outro membro perde o acesso a eles.
10. **Cartões compartilhados.** O cartão compartilhado aparece para os dois com o ciclo e o teto, e **o gasto do ciclo soma os lançamentos de ambos nesse cartão**. **Recomendo.** Pergunta aberta: o teto é editável pelos dois?
11. **Limite de pessoas.** 2 agora, evoluindo até 4 (decisão da 11a). Nada muda.

## 3. Segurança e isolamento (obrigatórios, estilo item 6)
- **Um único ponto de decisão de acesso** (`AccessScopeService`), que devolve para cada pedido o conjunto de donos e itens visíveis. Nenhuma consulta nova usa `userId` solto; nenhum id vindo do cliente decide o escopo.
- Acesso só com **membership ativa e plano Compartilhado ativo**, conferido na hora (não em cache longo).
- Respostas uniformes: item de outro grupo ou não compartilhado = 404 igual a inexistente.
- Testes A/B/C/D: A e B no mesmo grupo, C em outro grupo, D sem grupo; todos os endpoints, o bot e a exportação; mutantes sobre o ponto único de acesso; concorrência (marcar e desmarcar, sair do grupo no meio de uma edição).
- Sem chave de criptografia nova, sem dado financeiro novo no banco além de uma marca de compartilhamento por item.

## 4. Fatiamento proposto
- **11b-1 (backend):** marca de compartilhamento em lançamento, categoria e cartão; `AccessScopeService`; API para marcar e desmarcar; leitura com escopo "meu / compartilhado / tudo"; regras de saída, remoção e queda do plano; testes de isolamento.
- **11b-2 (app):** marcar o item como compartilhado, seletor "Meu / Compartilhado / Tudo", selo "compartilhado por <nome>", textos de privacidade.
- **11b-3 (bot e insights):** conversa com "compartilhado", insights e previsão por escopo, exportação e exclusão (LGPD).
- **11c:** metas, reservas, contas fixas e parcelados compartilhados.
Cada fatia: haiku implementa, sonnet revisa com Postgres/Redis descartáveis, mutantes e Chrome real; conferência do agente principal; relatório no repositório.

## 5. Fora de escopo
Carteira única migrando dados (opção a), permissões por categoria ou por item além de compartilhar ou não, convites por e-mail, mais de 4 pessoas, chat entre membros, aviso ao parceiro, divisão de despesa e "quem deve quanto".

## 6. Riscos
Mudar a regra "todo dado é filtrado por `userId`" em dezenas de consultas; vazar o total de alguém por agregação; queda do plano no meio de uma edição; migração com dados existentes. A mitigação é o ponto único de acesso, o escopo padrão "Meu" e os testes de isolamento.
