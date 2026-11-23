# Dúvidas do item 8a (backend) e decisões

Data: 2026-11-19.

1. "Apagar" (decidido pelo coordenador/dono): o texto "apagar" enviado como mensagem é o caminho único de apagar. Confirmar, sim e ok não apagam (respondem "Para apagar, responda apagar."). O endpoint /conversation/confirm recusa rascunho de apagar com ERROR "Para apagar, responda apagar.", sem gravar. O botão do app (8a-2) deve enviar a mensagem "apagar". Implementado em 8951c7a.
2. Comando de editar/apagar com rascunho em andamento de outro tipo: vale a regra atual do motor (comando de escrita com rascunho em coleta ou aguardando confirmação responde o lembrete e não substitui o rascunho). Sem regra nova.
3. "apagar conta" sem termo: a palavra "conta" sozinha vira ausência de termo e o motor pergunta "Qual lançamento?". Implementado em 1b9de59.
4. Lançamento não elegível (conta fixa, parcelado, meta ou nota): se todos os achados forem não elegíveis, a resposta é a mensagem de tela, sem sessão. Implementado em c59158c.
5. Desvio registrado: resposta "não achei" dentro de uma sessão já aberta (busca digitada depois de "apagar" sem termo) devolve ERROR e mantém a sessão, em vez de encerrá-la. O contrato pede sem sessão só na primeira busca, que é o caso implementado. Pendente de decisão se o dono quiser encerrar a sessão nesse caso.
6. Desvio registrado: categoria ambígua na edição pede o nome completo, em vez de oferecer opções numeradas como no criar lançamento. Decisão de escopo a confirmar.
7. Desvio registrado: categoria da edição não filtra por tipo (receita ou despesa) do lançamento. Pendente.
