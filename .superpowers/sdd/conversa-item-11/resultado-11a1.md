# Item 11a-1 — Backend do plano Compartilhado (grupo, convites e limites por plano) — resultado

Ramo: `feat/billing-grupos-11a1` da `develop` (contrato aprovado: `docs/superpowers/specs/2026-11-24-conversa-contrato-item-11.md`, D2 ajustado pelo dono para 2 pessoas).

## O que foi entregue

- **Schema/migração**: `GroupMembership` (pagador↔membro, `leftAt` de saída; índice único **parcial** "um grupo ativo por usuário" só na SQL — mesma lição do 9a, não rodar `migrate dev` sem revisar) e `GroupInvite` (só o **SHA-256 do token** no banco; token em claro vive apenas na resposta que cria o convite — D4). Migração `20261124150000_billing_groups` aplicada limpa em Postgres 18.6 descartável; `migrate diff` sem drift nos dois sentidos.
- **Catálogo (D2/D7)**: `SHARED.seats = 2` (para evoluir até 4 é trocar o número — nada de regra lê seats direto); `LimitedResource` ganhou `creditCards` com **FREE 1 / Individual 5 / Compartilhado 10** (o teto técnico do 9a virou o limite do SHARED), rótulo "cartões ativos" no `PlanLimitException`.
- **Plano efetivo com grupo (D6/D11)**: `EntitlementsService.resolvePlan` agora soma às assinaturas próprias as linhas **SHARED** do pagador do grupo ativo do usuário (INDIVIDUAL do pagador nunca empresta plano — 1 seat). Sem assinatura SHARED ativa do pagador, membro resolve FREE junto com todo o grupo.
- **`GET /billing/me`**: `plan` passa a usar a mesma resolução (ponto único); novo bloco `group`: `{role:'owner'}` para pagador (ainda owner com o plano caído, para poder reassinar) e `{role:'member', ownerFirstName}` para membro — os campos de cobrança (`status/source/currentPeriodEnd/latestInvoiceUrl`) ficam **null** para membro (ele não vê nada de cobrança alheia, D10).
- **Serviço único de grupo (`GroupService`) + rotas `/billing/group`** (D12): GET da visão (pagador: membros com os e-mails que ele mesmo convidou + convites pendentes + seats; membro: só primeiro nome + data), `POST invites` (7 dias, máx. 10 pendentes), `DELETE invites/:id`, `POST invite/accept` (logado com o mesmo e-mail; pagador/grupo-próprio 409; lugar e plano do pagador reconfirmados na transação com a linha do pagador `FOR NO KEY UPDATE`; aceitar troca de grupo automaticamente — D5), `POST leave`, `DELETE members/:id`. Erros de convite (desconhecido/expirado/revogado/consumido/e-mail diferente) são **404 com a mesma mensagem**.
- **Cartões por plano**: `CreditCardsService.create` pergunta `assertCanCreate(userId,'creditCards')` antes de gravar (vale para app, bot e WhatsApp — mesmo caminho); o teto técnico de 10 fica como cinto de segurança.
- **D9**: `CreateGrantDto` aceita `SHARED` (grant de admin vale como assinatura SHARED comum, `source: GRANT`, sem tolerância de atraso — o beneficiado vira pagador).

## Verificação (sessão única Qwen)

- Backend inteiro: **91 suítes / 2341 testes** verdes (`tsc --noEmit` e `nest build` ok).
- Suítes novas/ampliadas: `group.service.spec` **28** (bateria D12 em unidade: 404 uniforme, 403 de membro, 409 de lugares/pagador/plano caído, troca automática de grupo, corrida de aceite via P2002), entitlements **+13** (resolução via grupo, limites de cartões), billing.service **+6** (bloco `group`), credit-cards **+1** (gate D7 antes de gravar).
- Domínios afetados (motor de conversa, billing, cartões, ciclo, metas, reservas, fixas, parcelados, Selah) em **UTC / America/Sao_Paulo / Asia/Tokyo: 1524 testes × 3, 0 falhas**.
- Migração: `migrate deploy` + `migrate reset` limpos; índice parcial `GroupMembership_active_member_key` conferido no banco.
- **Integração real** (backend `dist` real + Postgres 18.6/Redis 8 descartáveis, `BILLING_ENABLED=true`, roteiro `~/tmp-lumen/integracao-11a1.mjs`): **25 checagens × 2 corridas, 0 falhas** — grant SHARED vira pagador (D9), membro resolve SHARED sem ver nenhuma cobrança do pagador, token só como hash no banco, **FREE 1 e SHARED 10 cartões com o 11º ouvindo `PLAN_LIMIT` (fecha a pendência de limite de cartões do item 9)**, 404 uniforme para convite inválido, 403 para membro que gerencia, 409 de lugares (D2=2) e de pagador recusando convite, saída/entrada e troca automática de grupo (D5), GET do membro sem vazar e-mail de ninguém (D6).
- Caçada a mutantes: **10/10 mortos** (filtro SHARED da busca do pagador, descarte das linhas alheias, `archivedAt` na contagem, teto de convites, `seats-1`, convite revogado, casamento de e-mail, primeiro nome, `||` do owner, gate do `create`); base verde e arquivos restaurados byte a byte (sha1 conferido) depois de cada mutante.
- Estabilidade: **12 corridas × 95 testes** das suítes novas/ampliadas (group/entitlements/billing.service/plans.catalog), 0 falhas.

## Descoberta registrada (não é bug)

Todo cadastro já nasce com o cartão padrão **"Principal"** — no FREE, a vaga única do D7 chega ocupada e o segundo cartão é recusado na hora. A integração testa a vida real (o FREE útil é "o padraio + nada além"), e o SHARED chega aos 10 **com** o padrão contando.

## NÃO verificado (aceito)

- Checkout Asaas vendendo SHARED (`sellable` continua **false** — vira `true` só na 11a-3 com app pronto).
- Fluxo de convite/aceite no app (é a 11a-2) — por enquanto só as rotas.
- Concorrência real de dois aceites simultâneos (a transação trava a linha do pagador; no unit a corrida é simulada via P2002).
