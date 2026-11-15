# Finanças por conversa: contrato do item 3a (consultas)

Data: 2026-11-15
Status: contrato escrito para aprovação do dono. Nenhum código foi criado.

Item 3a da "Ordem de implementação" de `2026-11-14-assistente-manual-financas.md`. Acrescenta ao motor do canal APP quatro consultas que não gravam nada: vencimentos, parcelas, contas fixas e metas. As escritas desse bloco (criar meta, aporte, recorrência, parcelado, conta fixa, limite do cartão) ficam no 3b.

Base: o motor, as tabelas e as rotas do item 1 e 2 já existem e não mudam. Este item **não cria tabela, migration, rota nem DTO de entrada**, e **não mexe no frontend**: a tela mostra o `text` da resposta, que já cobre as quatro consultas.

## 1. Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | As consultas chamam os serviços que as telas já usam: `RecurringTransactionsService.list`, `InstallmentsService.list`, `GoalsService.list`. | O bot mostra os mesmos números da tela e herda os filtros por `userId` desses serviços. Nenhuma regra nova de negócio no motor. |
| D2 | O motor só filtra, soma e formata o que o serviço devolveu. | Evita uma segunda fonte de verdade para "o que vence". |
| D3 | Leitura nunca é limitada por plano. | Princípio do produto (HANDOFF): ver o que já existe nunca é bloqueado. |
| D4 | Janela de "o que vence": os próximos 30 dias, contados a partir de hoje no fuso do usuário. | Número redondo e curto. O dono pode trocar. |
| D5 | Listas mostram no máximo 5 itens (8 em vencimentos) e dizem quantos ficaram de fora. | Mensagem curta, boa no celular e no WhatsApp. |

Efeito colateral que o dono deve conhecer: `RecurringTransactionsService.list` e `InstallmentsService.list` primeiro "trazem o calendário em dia", ou seja, criam os lançamentos de contas fixas e parcelas que já venceram. É o mesmo comportamento de abrir a tela de Finanças ou o dashboard. Perguntar "o que vence?" ao bot também faz isso. É automático e já existe; o bot não o introduz.

## 2. Intenções novas

Ids fixos, todos de leitura (sem confirmação, sem sessão). Mesma regra de normalização do matcher atual (minúsculas, sem acento, espaços colapsados). O texto deve ser **igual** à frase ou **começar** por ela seguida de espaço, como nas intenções existentes.

| Id | Frases | Observação |
|---|---|---|
| `upcoming_dues` | `o que vence`, `vencimentos`, `proximos vencimentos`, `contas a vencer` | Contas fixas de despesa e parcelas, juntas, por data. |
| `installments` | `minhas parcelas`, `parcelas`, `parcelados`, `compras parceladas` | Só parcelados ativos. |
| `fixed_bills` | `contas fixas`, `despesas fixas`, `gastos recorrentes`, `recorrencias` | Só recorrências ativas de **despesa**. |
| `goals` | `minhas metas`, `metas`, `minhas reservas`, `reservas`, `como esta minha reserva` | "Reserva" é meta sem alvo (cofrinho): vem do mesmo modelo `Goal`. |

Regras do matcher:

- Entram na tabela de leituras (`ReadIntent`). Ordem: depois de `create_*` e `spend_by_category`, antes de `credit_card`; nenhuma das frases acima pode capturar texto que hoje vai ao Selah. As sugestões prontas da tela do Selah ("Como posso acelerar minhas metas financeiras?", "Qual meta merece aporte agora?") **não** podem casar.
- `cartao`, `limite` e `quanto sobrou no cartao` continuam sendo `credit_card`.
- Durante um rascunho em coleta, essas leituras respondem e mantêm o rascunho, como `saldo` já faz.

## 3. Regras de cada consulta

Todas as datas: hoje = `localToday(agora, User.timezone)`. Valores em centavos inteiros (`toCents`), formatados com `formatBrl`. Datas no texto como `dd/mm`.

### `fixed_bills`
- Fonte: `RecurringTransactionsService.list(userId)`.
- Filtro: `isActive === true` e `type === 'EXPENSE'`. Ordem: `nextDueDate` crescente.
- Cada linha: descrição, valor, periodicidade (`mensal`, `semanal`, `anual`) e próximo vencimento.
- **Total mensal estimado:** soma por mês de cada conta: `MONTHLY` = valor; `YEARLY` = valor ÷ 12; `WEEKLY` = valor × 52 ÷ 12. Arredonda uma vez, no total, para centavos. O texto diz "estimado".
- Sem nenhuma: "Você ainda não tem contas fixas ativas."

### `installments`
- Fonte: `InstallmentsService.list(userId)`.
- Filtro: `isActive === true` e `remainingInstallments > 0`. Ordem: `nextDueDate` crescente.
- Cada linha: descrição, "parcela X de N" onde `X = installmentsGenerated + 1`, valor da parcela e data da próxima.
- Fecha com: total ainda a pagar (soma de `remainingAmount`) e o **próximo impacto** (valor e data da parcela mais próxima).
- Sem nenhuma: "Você não tem compras parceladas em aberto."

### `upcoming_dues`
- Fontes: as mesmas recorrências de despesa ativas e os parcelados ativos com `nextDueDate` não nulo.
- Janela: `hoje <= nextDueDate < hoje + 30 dias`. Vencimento anterior a hoje não aparece (o calendário já foi trazido em dia pelo serviço).
- Ordem por data; empate por valor decrescente. Cada linha: data, descrição, valor, e o tipo (`conta fixa` ou `parcela X/N`).
- Rodapé: total da janela. Itens além do limite viram "e mais N".
- Sem nenhum: "Nada vence nos próximos 30 dias."
- Uma conta fixa semanal conta uma vez (o próximo vencimento), não todas as ocorrências da janela.

### `goals`
- Fonte: `GoalsService.list(userId)`.
- Mostra metas com `status === 'ACTIVE'`, ordenadas por `targetDate` (sem data por último). Metas `PLANNED`, `PAUSED` e `ACHIEVED` não aparecem, mas se existirem o texto fecha com "Você tem N meta(s) pausada(s), planejada(s) ou concluída(s)." quando N > 0.
- Meta com alvo: "guardado de alvo (X%)", quanto falta e prazo se houver. `X% = floor(currentAmount / targetAmount × 100)`, no máximo 100.
- Meta sem alvo (cofrinho/reserva): "R$ X guardados (sem alvo)".
- Sem nenhuma ativa: "Você ainda não tem metas ativas."

## 4. Resposta

`ConversationReply` com `kind: 'INFO'`, `state` = estado atual (`IDLE`, ou o do rascunho em coleta), `text` em template pt-BR com quebras de linha, sem `draft`. Exemplo de `installments`:

```
Parcelas em aberto (2):
• Notebook: parcela 3 de 10, R$ 450,00, próxima em 05/12
• Sofá: parcela 1 de 6, R$ 300,00, próxima em 20/12
A pagar ao todo: R$ 4.500,00. Próximo impacto: R$ 450,00 em 05/12.
```

Acréscimo em `ReplyData` (centavos, para o canal que quiser desenhar algo além do texto): 

```ts
dues?: Array<{ date: string; label: string; kind: 'FIXED' | 'INSTALLMENT'; amountCents: number }>;
installments?: Array<{ label: string; number: number; total: number; amountCents: number; nextDate: string | null }>;
fixedBills?: Array<{ label: string; frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY'; amountCents: number; nextDate: string }>;
goals?: Array<{ label: string; currentCents: number; targetCents: number | null; percent: number | null; targetDate: string | null }>;
totalCents?: number;   // total a pagar (installments), total da janela (upcoming_dues), total mensal estimado (fixed_bills)
```

Esses campos são aditivos: o frontend atual os ignora. O front só precisa de mudança se o dono quiser desenhar tabelas no futuro.

## 5. Segurança e erros

- `userId` vem só do argumento do motor. Cada consulta passa esse `userId` ao serviço; nenhuma consulta aceita id vindo do texto da mensagem.
- Falha em qualquer serviço: resposta `ERROR` com texto genérico ("Não consegui consultar agora. Tente de novo."), evento `ERROR` sem texto da mensagem, nenhum detalhe interno na resposta. Mesmo tratamento das leituras atuais.
- Descrições de lançamentos e de metas são texto livre do próprio usuário. Vão para a resposta sem interpretação, mas com limite de 60 caracteres por linha (truncar com "…") para não estourar a mensagem.
- Eventos: um `ConversationEvent` por consulta com `intent` e `outcome RECOGNIZED`, sem texto.

## 6. Testes exigidos

- Cada frase da seção 2 casa a intenção certa; as sugestões prontas do Selah não casam; "cartão" continua `credit_card`.
- Cada consulta: caso vazio, caso com itens, caso com mais itens que o limite ("e mais N"), descrição longa truncada.
- `fixed_bills`: filtra inativas e receitas; total mensal estimado com mensal, semanal e anual juntos.
- `installments`: ignora quitadas e inativas; "parcela X de N" correto; próximo impacto é a data mais próxima.
- `upcoming_dues`: respeita a janela de 30 dias (dia 29 entra, dia 30 não), usa o fuso do usuário, mistura conta fixa e parcela por data, não repete conta semanal.
- `goals`: percentual com `floor`, teto de 100%, cofrinho sem alvo, aviso de metas fora da lista.
- Isolamento A/B: cada consulta da conta A chama o serviço com `'A'` e jamais mostra item de B. Mutante: trocar o `userId` repassado ao serviço por outro valor derruba o teste.
- Falha do serviço vira `ERROR` genérico, sem texto interno.
- Leitura durante rascunho em coleta mantém o rascunho.
- Suíte inteira do backend continua verde, em `TZ=UTC`, `America/Sao_Paulo` e `Asia/Tokyo`.

## 7. Arquivos

Só dentro de `backend/src/conversation/`: `parsers/intent.matcher.ts` (+spec), `conversation.service.ts` (+spec), `replies.ts`, `conversation.types.ts` (`ReplyData`), `conversation.module.ts` (importa `GoalsModule`, `InstallmentsModule`, `RecurringTransactionsModule`). Nenhum arquivo fora dessa pasta.

## 8. Decisões abertas do dono

1. Janela de 30 dias em "o que vence": manter, ou preferir 7, 15 ou até o fim do mês?
2. "Reserva" aqui é meta sem alvo (`Goal`). O app também tem **envelopes** (valor reservado todo mês, como "gasolina"). O 3a não os cobre. Quer uma consulta de envelopes depois?
3. "O que vence" deve incluir receitas recorrentes (como salário)? Padrão deste contrato: não.

## 9. Fora deste contrato

Criar ou alterar meta, reserva, aporte, recorrência, parcelado, conta fixa e limite do cartão (3b). Importação de nota (4). WhatsApp (5).
