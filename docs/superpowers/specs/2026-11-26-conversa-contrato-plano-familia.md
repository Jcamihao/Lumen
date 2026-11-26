# Contrato: plano Família (rascunho para veto do dono)

Data: 2026-11-26. Origem: pedido do dono. Status: **rascunho**; o preço está em aberto (seção 6). Nada de código foi escrito.

## 1. O que o dono decidiu (2026-11-26)
- Existem **dois planos**: Compartilhado e Família. Os dois aceitam **de 2 a 4 pessoas**.
- A diferença principal: na **Família as metas são compartilhadas**. O criador escolhe com quem: só uma pessoa, só outra, ou todas. Quem recebe a meta **adiciona valores e edita**.
- Permissões da meta compartilhada: quem recebeu aporta e edita; **só o criador apaga e escolhe com quem compartilha**.
- O aporte fica **no livro de quem aportou**; a meta soma todos os aportes e mostra quem colocou quanto.
- Quem sai da família, ou o plano que cai: a meta **volta a ser só do criador** e os aportes feitos continuam na soma.
- Aprovou as ideias a seguir para a Família (seção 3), todas.

## 2. Plano Compartilhado (casal ou parceiros)
Lançamentos, categorias e cartões compartilhados (11b-1), contas fixas e parcelados compartilhados (11c), de 2 a 4 pessoas, todos com os mesmos poderes. **Metas e reservas continuam privadas.** (Assumido pela sessão; o dono pode vetar.)

## 3. Plano Família: tudo do Compartilhado, mais
1. **Metas compartilhadas por pessoa.** Tabela nova de "quem recebe" (meta + membro). Só o criador mexe na lista.
2. **Reservas (envelopes) compartilhadas por pessoa.** Mesma tabela e mesma regra da meta. O gasto de cada membro entra no livro dele, ligado à reserva pelo campo `envelopeId` do lançamento; a reserva soma o gasto de todos os que têm acesso.
3. **Visão "Casa".** Saldo e gastos do grupo somados no mês, com a divisão por pessoa. Só entra o que cada um marcou como compartilhado.
4. **Responsável e dependentes.** O pagador é o responsável. Ele define um limite mensal para um dependente (ex.: mesada). O app avisa o dependente e o responsável aos 80% e aos 100%. O dependente só vê o que foi compartilhado com ele. Versão 1: **sem aprovação de gastos**. O dependente ocupa uma vaga.
5. **Resumo mensal da família por e-mail**, no dia 1, para todos os membros que não desligaram o e-mail (respeita as preferências de e-mail).
6. **Tarefas da casa.** Lista compartilhada com responsável e prazo. Muda a regra do item 11 ("tarefa nunca é compartilhada"): o dono aprovou, então vale só para a Família.
7. **Lembrete de conta compartilhada para todos os membros**, e não só para quem criou.
8. **Cotas maiores** de importação de nota fiscal e de perguntas ao assistente. Números no catálogo de planos (seção 6).

## 4. Regras técnicas (decididas por esta sessão; o dono pode vetar)
- **D1 Aporte em meta alheia.** O `GoalsService.contribute` hoje trava e lê a meta com `id + userId`. Passa a aceitar o dono ou um membro com acesso. O lançamento (TRANSFER com `linkedGoalId`) nasce com o `userId` de quem aportou; `currentAmount` da meta continua sendo a soma. O "quem colocou quanto" sai dos lançamentos ligados à meta, por `userId`.
- **D2 Isolamento.** A identidade vem sempre do token. Um membro só enxerga e mexe em meta ou reserva que o criador marcou para ele, e só enquanto o plano Família do grupo estiver ativo.
- **D3 Plano cai ou membro sai.** As linhas de "quem recebe" daquele membro são apagadas (ou todas, se o plano cai). A meta e a reserva ficam com o criador. Os aportes já feitos continuam na soma.
- **D4 Privacidade da reserva.** O membro vê o total gasto e o gasto por pessoa. A descrição e o valor de cada lançamento alheio só aparecem se aquele lançamento também foi marcado como compartilhado.
- **D5 Plano Família é o único com metas e reservas compartilhadas.** O Compartilhado recusa com a mensagem padrão de plano.
- **D6 Papéis.** Responsável = pagador do grupo. Dependente = membro com limite. Um membro comum não tem limite.
- **D7 Concorrência.** Aportes simultâneos na mesma meta continuam serializados pelo lock da linha da meta (`FOR NO KEY UPDATE`), agora pela meta do criador.

## 5. Fatias (cada uma: contrato curto, código, testes, mutantes, integração real, merge `--no-ff`)
1. **Catálogo:** plano FAMILY (2 a 4 vagas) e Compartilhado de 2 a 4 vagas, `sellable: false` até a venda ficar pronta.
2. **Metas compartilhadas por pessoa** (backend, depois app).
3. **Reservas compartilhadas por pessoa** (backend, depois app).
4. **Visão "Casa".**
5. **Responsável e dependentes** com limite e avisos.
6. **Resumo mensal por e-mail e lembrete de conta para todos.**
7. **Tarefas da casa.**
8. **Bot (Telegram e WhatsApp):** ver metas compartilhadas, aportar, ver reservas compartilhadas.
9. **Venda da Família:** checkout no Asaas, landing e cotas. Precisa de preços e chaves do dono.

Ordem recomendada: 1, 2, 3, 4, 6, 5, 7, 8, 9.

## 6. Em aberto para o dono
- **Preço da Família** (mensal e anual). Hoje o Compartilhado custa R$ 24,90 por mês ou R$ 249 por ano.
- **Preço por grupo ou por vaga?** Com 2 a 4 pessoas, a conta muda. Recomendação: preço fixo por grupo até 4 pessoas, mais simples de vender e de cobrar.
- **Quantas vagas o Compartilhado terá de fato** (2, 3 ou 4). O dono disse "2 a 4" para os dois.
- **Cotas** (nota fiscal e assistente) de cada plano.

## 7. NÃO verificado
Nada foi implementado nem testado. Falta conferir no código: o fluxo de cobrança do Asaas por plano, as telas de Metas e Reservas do app, e como o resumo mensal atual é montado. A suposição da seção 3, item 2, sobre `envelopeId` foi conferida no schema (`Transaction.envelopeId`), mas não o cálculo do "gasto" na `EnvelopesService`.
