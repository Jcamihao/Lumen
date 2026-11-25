# Conversa — Contrato do item 11: billing, planos e plano Compartilhado (2026-11-24)

**APROVADO pelo dono em 2026-11-24** ("d2: 2 pessoas e podendo evoluir para até 4 pessoas, de resto tudo ok"). Vale para a 11a; a 11b pede aditivo próprio (D6).

Pedido pelo dono em 2026-11-24 (HANDOFF, seção 7, item 11): **rever os planos do app e fazer o plano Compartilhado/Família de verdade** — membros, convites, dados compartilhados e um plano cobrado para vários usuários. Este contrato foi rascunhado pela sessão Qwen contra o código e **aguarda aprovação do dono decisão por decisão** (estilo 8c/8d). Nada de código antes da aprovação.

**Situação atual (verificada no código em 2026-11-24):**
- Catálogo em `backend/src/billing/plans.catalog.ts`: `FREE` (metas 2, reservas 1, contas fixas 3, parcelados 2, Selah 5/mês, 1 seat), `INDIVIDUAL` (sem limites, Selah 300/mês, R$ 14,90/149, `sellable: true`), `SHARED` (igual ao Individual, **`sellable: false`**, `seats: 4`, R$ 24,90/249 já com env `BILLING_PRICE_SHARED_*`).
- `Subscription` (Prisma) já tem `seats` e o enum `BillingPlan` já tem `SHARED`; checkout **recusa** plano não-sellable (`billing-payments.service.ts`); resolução do plano efetivo é ponto único (`pickEffectivePlan`/`subscriptionGrantsAccess` com 7 dias de tolerância do Asaas); limites/Selah vêm do catálogo via `EntitlementsService`.
- Não existe `SubscriptionMember` nem convite: o Compartilhado é hoje "só estrutura" (spec `2026-09-27-billing-design.md`, seção de fora-de-escopo).
- Pendência do item 9: **limite de cartões por plano** (hoje só o teto técnico de 10).

---

## Decisões (aprovar ou corrigir cada uma)

### D1 — Duas fases dentro do item 11
**Recomendação: sim.** **11a = "plano família" (billing com seats):** várias contas usam o plano pago do pagador, **sem compartilhar NENHUM dado** — a regra de isolamento "identidade vem do token, dado é do dono" continua 100% intacta. **11b = "dados compartilhados" (carteira compartilhada):** contrato aditivo próprio depois, com decisões de privacidade separadas. Motivo: a parte de dinheiro+convites é difícil sozinha; misturar com a mudança estrutural do isolamento (a maior risco do roteiro) num passo só não vale o prazo. O escopo do HANDOFF ("dados compartilhados") fica entregue — só que na 11b.

### D2 — Seats e preço — **APROVADO COM AJUSTE pelo dono (2026-11-24)**
**Decisão do dono:** `SHARED` = **2 pessoas** (o pagador + **1** convidado) no lançamento, **podendo evoluir para até 4** sem reforma. Implementação: o `seats` do catálogo passa a `2` para SHARED e **tudo que limita gente lê `getPlan(...).seats`** (convite, aceite, testes) — para virar 4 depois é trocar o número no catálogo (e o preço, se o dono quiser), sem tocar em regra. Preço **fixo do grupo** (R$ 24,90/mês ou R$ 249/ano pelas envs atuais — valor final é do dono na hora de vender), não importa quantos membros entraram — nada de preço por seat no Asaas (o Asaas assina o pagador; membros não pagam nada). `FREE` e `INDIVIDUAL` continuam 1 seat.

### D3 — Papéis
**Recomendação:** dois papéis só: **pagador** (dono da assinatura: convida, remove, cancela, troca plano/intervalo — tudo o que existe hoje em `/plano`) e **membro** (usa o plano; pode **sair** sozinho; não vê nada de cobrança do outro). **Sem transferência de pagamento** na v1 (vira pagador de outro grupo quem criar o próprio grupo; trocar de pagador = cancelar + novo grupo — registro no contrato como limitação).

### D4 — Convites
**Recomendação:** convite **por e-mail** criado pelo pagador na tela "Plano e membros"; link com token aleatório (só hash no banco), válido por **7 dias**, revogável; o convite aceita **conta existente** ou **conta criada depois do convite** (convidado abre o link, se não tiver conta registra e o convite é consumido no registro-aceite). Máximo de 10 convites pendentes por grupo. E-mail de convite: **sem provedor de e-mail no projeto hoje** — na v1 o app mostra o link do convite para o pagador copiar e mandar por qualquer meio (mesma lição do código de vínculo do 5b/10b); envio de e-mail fica fora (a spec de billing já deixa e-mails de cobrança com o Asaas).

### D5 — Quem pode estar em quê
**Recomendação:** um usuário em **no máximo UM grupo ativo** por vez; aceitar convite **sai automaticamente** do grupo em que era membro (nunca do que era pagador — pagador precisa desfazer/cancelar o próprio antes). O pagador pode ter o próprio plano pago E ser membro? **Não.** Membro removido ou grupo expirado: perde o acesso na hora (mesma regra de `subscriptionGrantsAccess`), dados continuam todos dele — ninguém perde dado ao cair de plano (princípio do projeto).

### D6 — Privacidade na 11a
**Recomendação:** em 11a **nada** é compartilhado — membros não listam nem leem nada um do outro; a única coisa que a associação muda é `pickEffectivePlan` do convidado responder `SHARED` (via membership ativa + assinatura ativa do pagador). Toda leitura continua por `userId` do token. A 11b (carteira compartilhada) terá seção própria de privacidade (o que é compartilhado, visibilidade entre membros, remoção de membro sobre dado compartilhado, exportação) **antes** de qualquer código dela.

### D7 — Limites por plano (fecha a pendência do item 9)
**Recomendação:** **cartões:** `FREE` **1**, `INDIVIDUAL` **5**, `SHARED` **10** (mantém o teto técnico de 10 do 9a como limite do SHARED — um degrau a mais se um dia quiser); `LimitedResource` do catálogo ganha `creditCards` e o `CreditCardsService` passa a consultar `EntitlementsService` (hoje o limite é constante solta). Os limites atuais de metas/reservas/contas/parcelados e Selah continuam como estão (revisão pedida = conferir e aprovar, não mexer). **Selah do SHARED é por pessoa** (cada membro tem os 300/mês), não um pool.

### D8 — Venda e bandeira
**Recomendação:** `SHARED.sellable = true` só no commit que fechar a 11a com app pronto (a flag é o interruptor: checkout já recusa sem ela). A landing/preços mostra "Compartilhado — em breve" até lá (texto da landing hoje já diz isso). Sem feature flag nova, sem env nova além dos `BILLING_PRICE_SHARED_*` que já existem.

### D9 — Concessões (founder grant) e admin
**Recomendação:** grant de `SHARED` pelo admin vale como assinatura SHARED comum (o beneficiado vira pagador e pode convidar) — mesmo `source: 'GRANT'` de hoje, sem grace. Nada novo na tela de admin.

### D10 — App (tela "Plano e membros")
**Recomendação:** em `/plano` existente: quando o plano efetivo é SHARED, aparece o bloco **"Membros"** (lista com e-mail/nome mascarado, papel, remover, copiar link de convite, convidar por e-mail) para o pagador; para membro aparece "Sair do grupo" com confirmação em duas etapas (padrão do app) e **zero** dados dos outros. Quem está em grupo como membro vê no `/plano` "Plano Compartilhado de <primeiro nome do pagador>" (só o primeiro nome é dado de contato do pagador — nada além disso vaza) e o botão de sair. Sem tela nova de rota: bloco dentro de `/plano`.

### D11 — O que acontece com membros quando o dinheiro falha
**Recomendação:** assinatura do pagador `PAST_DUE`/`CANCELED`/`EXPIRED` → **todos** perdem o SHARED juntos (membros caem para FREE conforme `subscriptionGrantsAccess` já calcula — membro nenhum é cobrado, ninguém é pego de surpresa com cartão). Ao aceitar convite, o convidado recebe no app um aviso do que vai ganhar (e do que perde se estava em outro grupo). Sem e-mail (D4).

### D12 — Isolamento e segurança (testes obrigatórios, estilo item 6)
Todo acesso a `memberships/invites` passa por serviço único com `userId` do token; testes A×B×C: B convidado não lê/gerencia o grupo de A sem convite válido; convite expirado/revogado/consumido 404 igual a inexistente; aceitar convite de grupo cheio 409; membro tenta convidar/remover/sair-do-pagador 403; convidado com plano próprio ativo continua resolvendo o plano maior (dois caminhos ativos, `PLAN_RANK` decide); pagador removendo a si mesmo é impossível. Mutantes no `pickEffectivePlan` estendido e na aceitação de convite. Integração real em Postgres/Redis descartáveis (nunca o 5433 legado).

---

## Fatiamento proposto
- **11a-1** backend: `GroupMembership`/`GroupInvite` + serviço único + convites + papéis + `pickEffectivePlan` estendido + testes de isolamento (D12) e `creditCards` no catálogo (D7).
- **11a-2** app: bloco "Membros" em `/plano`, convidar/copiar link, aceitar convite (rota do link), sair do grupo; karma + build.
- **11a-3** fechamento: `sellable: true` + landing/preços, integração real, nota + tag do item.
- **11b** carteira compartilhada: **outro contrato** (privacidade primeiro). Sandbox real do Asaas (pendência 2 do billing) pode acontecer junto com a 11a-3 — depende da conta sandbox do dono.

## Fora de escopo (registrado)
Transferência de pagamento; cobrar por seat além do preço do grupo; e-mail transacional de convite; trocar assento entre grupos sem sair; dados compartilhados (é a 11b); NFS-e, cupons, tela de faturas (já fora da spec de billing).
