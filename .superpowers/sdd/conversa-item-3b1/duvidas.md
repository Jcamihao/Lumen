# Dúvidas e decisões do backend (item 3b1)

Data: 2026-11-15. Nenhuma dúvida bloqueou o trabalho: em cada ponto abaixo o contrato era omisso ou ambíguo, e a escolha feita está indicada. O dono pode trocar qualquer uma.

## Pontos levantados e estado após a revisão

1. **Resolvido pelo agente principal:** `criar cofrinho X` nasce sem alvo, sem fazer a pergunta. Números no corpo ficam no nome. Implementação, contrato e testes foram corrigidos.
2. **Mantido conforme brief:** o descarte por erro 4xx vale também para lançamento. Uma recusa de `TransactionsService.create` descarta o rascunho; a mensagem de lançamento é própria. Não foi tratado como nova autorização para alterar outros serviços financeiros.
3. **Resolvido pelo agente principal:** aporte sem valor cujo nome não corresponde a meta ativa devolve `unrecognized: true`. `guardar dinheiro é importante` pode seguir ao Selah, sem abrir rascunho. Com valor explícito, uma meta inexistente continua provocando recusa e lista das metas.
4. **Formato mantido:** `rows` usa dd/mm/aaaa também para lançamento; `DraftView.date` continua ISO. É a apresentação já usada pela tela.
5. **Autorizado explicitamente pelo dono em 2026-11-15:** corrigir `GoalsService` e seus testes, além do escopo original, para impedir aporte parcialmente persistido e repetição induzida por falha de cache/notificação depois de gravar. A transferência e a atualização agora são atômicas e aportes concorrentes são serializados pelo bloqueio da meta do dono.

## Decisões onde o contrato era omisso (já implementadas)

- `DraftView.amount` e `DraftView.date` viraram `string | null` (o contrato diz "demais campos nulos" em meta e aporte). Mudança de tipo visível ao frontend. Está em `contrato-tipos.md`.
- "sem alvo" escrito junto do comando ("criar meta viagem sem alvo") fecha como cofrinho. Sem isso o nome ficaria "viagem sem alvo".
- Nome de 1 caractere no comando é tratado como ausente (pergunta o nome). Nome com mais de 60 caracteres recusa com `ERROR`: na abertura não cria sessão; durante a coleta mantém o rascunho existente.
- Nome igual a meta ativa é recusado ao abrir e, durante a coleta, mantém a pergunta de nome com o aviso.
- Resposta de alvo com texto extra ("3000 reais") pede de novo a pergunta de alvo (`ASK`), sem erro.
- Resposta de meta que não casa com as opções pede de novo a pergunta de meta. Não descarta o rascunho.
- Textos de falha inesperada por tipo: meta e aporte têm texto próprio (`goalSaveFailed`, `contributionSaveFailed`). O contrato não fixava o texto.
- Aporte: a meta usada no rascunho é lida no momento de mostrar (`goals.list`), não congelada. Assim o "conclui a meta" e a barra de guardado refletem o valor atual. A confirmação usa o valor real do serviço, e o `DONE` também.
- Aporte com valor explícito e meta não encontrada usa `ERROR`. Sem valor e nome sem correspondência, vale a exceção de fallback descrita acima.
- Leitura `envelopes`: `ReplyData.totalCents` guarda o total disponível (reuso do campo). Reservas além de 5 aparecem como "e mais N".
- Defesa em profundidade: o motor descarta meta cujo `userId` não é o da conta, além do filtro do serviço. Cobre o mutante 4 do contrato.
- Opção de meta removida/desativada preserva o número como `indisponível`, evitando que uma escolha vá para outro destino.
- Os avisos de conclusão da meta e data futura entram em `draft.rows` para permanecer visíveis no cartão, inclusive após recarregar a página.

## Riscos conhecidos (não resolvidos)

- Campo pendente de texto livre (nome de meta, descrição) que começa por número ou verbo de comando é lido como comando. Ex.: meta "2024 viagem" vira lançamento e sai o aviso de rascunho em andamento. Já existia para descrição; agora vale para nome de meta também.
- Expiração preguiçosa: rascunho de meta ou aporte esquecido só expira na próxima mensagem (igual ao lançamento).
