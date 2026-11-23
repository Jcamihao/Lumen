# Contrato do item 8b: editar e apagar metas e reservas por conversa

Status: **RASCUNHO — aguarda aprovação do dono** (decisões abertas na seção 8). Base: padrões do 8a (contrato 2026-11-19) já fechados na `develop`. Entrega sugerida em duas fatias: 8b-1 backend, 8b-2 frontend (o cartão do 8a-2 já faz quase tudo).

## 1. Situação hoje (lido no código em 2026-11-23)

- **Meta** (`Goal`): `title`, `description?`, `targetAmount?` (null = cofrinho sem alvo, nunca vira `ACHIEVED` sozinha), `currentAmount`, `targetDate?`, `status` (PLANNED/ACTIVE/ACHIEVED/PAUSED), `recurringAmount?`/`recurringDay?` (aporte automático no pulse). `GoalsService.remove` desvincula tarefas e transações (`linkedGoalId` → null; aportes **ficam no extrato**) e apaga a meta. `update` aceita title, description, targetAmount, targetDate, status, currentAmount, recurringAmount/Day.
- **Reserva** (`Envelope`, no app é "envelope"): `name` (único por usuário), `color`, `icon?`, `monthlyAmount`, `isActive`. Depósitos mensais são `EnvelopeTopUp` (cascade no delete). Gastos ligados usam `Transaction.envelopeId` (SetNull no delete — as transações **ficam**). `EnvelopesService.update` reativar reserva pausada **consome entitlement** (`assertCanCreate`); mudar `monthlyAmount` só vale do depósito futuro em diante (depósitos criados ficam congelados). `remove` apaga o cofre e os topups.
- **Aporte/saque de meta** são `Transaction` tipo `TRANSFER` com `linkedGoalId`. No 8a esses lançamentos ficaram **fora** do editar/apagar (TRANSFER e `linkedGoalId` já excluíam).
- A conversa já **cria** meta (`applyGoal`), faz **aporte** (`applyContribution` via `GoalsService.contribute`) e **cria reserva** (`applyEnvelope` via `createForConversation` com mês de provisão). Não existe nenhuma intent de **editar/apagar** meta ou reserva: hoje isso só acontece pela tela.
- O motor já tem `this.goals` e `this.envelopes` injetados — a 8b grava **pelos mesmos serviços da tela**, como o 8a faz com `TransactionsService`.

## 2. Escopo

**Dentro:** editar e apagar metas e reservas por conversa, seguindo de ponta a ponta o padrão do 8a: intent com termo → busca → lista numerada → escolha → prévia (edição com "antes → depois"; apagar com o alvo detalhado) → confirmação explícita → aplicação com releitura `id + userId`, checagem de elegibilidade, checagem de `updatedAt` e recibo; idempotência por `appliedKey`; isolamento 404; trava de escrita do WhatsApp; rascunho restaurável (`getSession`) com `changeAction`.

**Fora (este contrato):** apagar/editar aportes e saques (são TRANSFER — decisão 4); saque por conversa; editar descrição, status (pausar/retomar), cor/ícone e recorrente de meta (decisões 2/3); criar qualquer coisa (já existe); limites; qualquer mudança de schema.

## 3. Vocabulário e busca

- Intents novas: `editar/apagar/corrigir/mudar` + substantivo (`meta|cofrinho` | `reserva|envelope`) + termo opcional. "meta X" casa com `Goal.title`; "reserva X" casa com `Envelope.name`. Sem substantivo ("apagar meta" vazio) pergunta qual; "editar" sem nada segue o texto atual do 8a (lançamento) — o substantivo escolhe o tipo do alvo.
- Metas: `title` pode repetir → busca por substring (case-insensitive, normalizada como no 8a) sobre metas **de qualquer status**, ordenadas por `updatedAt` desc, janela **sem limite de data** (meta não tem "últimos 180 dias"), teto de 5 candidatos. Reservas: `name` é único, mas a numeração segue igual por consistência; exclui pausadas só quando houver ativa com o mesmo termo.
- Nenhum match → INFO "Não achei…" (sem sessão). Lista com o status visível (ex.: "PAUSADA" escrito "pausada") para o usuário saber o que está mexendo.

## 4. Apagar (meta e reserva)

- Fluxo espelha o 8a: palavra `apagar` (ou `delete: true` explícito do botão do app) única confirma; `confirmar`/`sim` respondem o texto de precisa-da-palavra.
- Prévia do apagar (linhas no cartão, texto no chat): meta — título, guardado/alvo, status, data; reserva — nome, valor mensal, situação (ativa/pausada), **total depositado no ano** não entra (custo/benefício), mas o texto avisa o que acontece com os depósitos e gastos ligados.
- **Semântica = exatamente a da tela** (decisão 1): apagar meta mantém os aportes no extrato como transferências soltas; apagar reserva apaga os topups (depósitos somem) e mantém os gastos marcados, soltos. O texto do recibo diz isso em uma linha.
- Aplicação: releitura `id + userId`, checagem de `updatedAt` **desde já para editar e apagar** (lição do 8a), depois `GoalsService.remove` / `EnvelopesService.remove`.

## 5. Editar (campos pelo chat)

- Uma mudança por mensagem, prévia "antes → depois" por campo (mesma fábrica de linhas do 8a-2), `updatedAt` no rascunho, aplicação com `GoalsService.update` / `EnvelopesService.update` (DTO parcial da tela).
- **Meta** (decisão 2): `título`, `valor alvo` (inclui "sem alvo" → null), `prazo` (`data X` / `sem prazo`). Fora: saldo (`currentAmount` — mexe em dinheiro, só por aporte/saque na tela), descrição, status, recorrente.
- **Reserva** (decisão 3): `nome` (serviço devolve erro amigável de duplicado) e `valor mensal` (prévia avisa: "vale a partir do próximo depósito"). Fora: pausar/reativar (reativação consome entitlement — fica para item próprio), cor/ícone.
- Campo sem valor parsing ("mudar valor") pergunta de novo; valor inválido usa o mesmo texto de erro de valor do motor.

## 6. Invariantes (vêm do 8a, continuam valendo)

- Identidade só do usuário autenticado; toda leitura/escrita com `id + userId`.
- Nada é gravado sem confirmação explícita; apagar exige a palavra (ou a flag literal `delete: true` — o DTO do 8a-2 já é rígido).
- Conflito: `updatedAt` mudou desde a prévia → recusa "mudou desde que você escolheu; refaça a busca" nos dois caminhos dos dois alvos.
- Idempotência: `appliedKey` no evento; reentrega não repete `remove`/`update`.
- Isolamento A/B: rascunho/confirm de outro dono = 404/sem sessão, sem revelar existência.
- WhatsApp: mesma trava de escrita; app: `ConfirmConversationDraftDto` já cobre (sem mudança de DTO).
- Erro auxiliar pós-commit (touch/notification) não desfaz gravação (padrão do motor).

## 7. Frontend (8b-2, pequeno)

O cartão do 8a-2 já renderiza qualquer rascunho com `changeAction` + `rows`: "Apagar de vez" com flag explícita, "antes → depois", RESTORED. Basta o `DraftView` dos novos rascunhos trazer `changeAction` e `kind` novo (`GOAL_CHANGE`/`ENVELOPE_CHANGE` ou `kind` mantido com substantivo — deixar `DraftKind` do app bater) e os títulos ("Editar meta"/"Editar reserva"). Karma cobre rótulo, flag, busy e quickReplies filtrados.

## 8. Decisões abertas do dono (perguntar antes de implementar)

1. **Semântica do apagar igual à tela** (meta mantém aportes soltos; reserva apaga depósitos e mantém gastos), sem bloquear alvo com saldo/depósitos? Recomendo: sim, igual à tela, com aviso na prévia.
2. **Campos de meta pelo chat**: só título/alvo/prazo (sem recorrente, sem status, sem saldo)? Recomendo: sim.
3. **Reserva pelo chat**: só nome e valor mensal (sem pausar/reativar)? Recomendo: sim.
4. **Aportes e saques** (as transferências ligadas à meta) continuam fora do editar/apagar? Recomendo: sim, ficam fora.
5. **"pausar/retomar" meta ou reserva por conversa** vira item próprio depois (por causa do entitlement na reativação) — registrar como pendência ou já descartar? Recomendo: registrar como item futuro.

## 9. Fatias e verificação

- **8b-1 backend**: intents/busca/rascunhos (`GOAL_CHANGE`/`ENVELOPE_CHANGE` reaproveitando a máquina do `TRANSACTION_CHANGE` — decidir na implementação se unifica o draft), `toDraftView`, aplicação pelos serviços, isolamento, specs no padrão `transaction-change.spec.ts` + mutantes + integração real em Postgres/Redis descartáveis (5433 é intocável — usar contêiner próprio) e 3 fusos.
- **8b-2 frontend**: `DraftKind`/rótulos/karma do cartão.
- Cada fatia: `tsc`, suíte inteira, mutantes, relatório em `.superpowers/sdd/conversa-item-8b/`, merge `--no-ff` na `develop` pelo agente principal.
