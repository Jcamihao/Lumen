# Handoff do Lumen

Última atualização: 2026-11-14. Escrito para quem nunca viu o projeto.

## 1. Projeto

Lumen é um SaaS de organização de vida, feito pela codeStage Soluções. Junta tarefas, dinheiro (lançamentos, metas, reservas, contas fixas, parcelados), lembretes e um assistente de IA (Selah) numa experiência só, mobile-first e offline-first. O público é pessoa física que quer clareza sobre o próprio dia e dinheiro.

Princípio que mais pesa nas decisões: privacidade e simplicidade. O app nunca vê nem guarda CPF ou dado de cartão (o pagamento é num checkout hospedado do Asaas). Exportar os próprios dados, MFA e ver/editar o que já existe nunca são limitados por plano. Ninguém perde dado ao cair de plano.

## 2. Repositório

- Caminho local: `/home/caminhao/coding/codeStage/Lumen`
- Remoto: `git@github.com:Jcamihao/Lumen.git`
- Branch: `master`
- Convenção de commit: Conventional Commits em português (`feat(billing): ...`, `fix(billing): ...`, `docs: ...`, `refactor(backend): ...`).
- Estado do git em 2026-11-15: working tree limpo depois dos commits do 2b. A branch está 15 commits à frente de `origin/master`; nada foi enviado. Esta informação vem do `git status -sb` local, sem `git fetch`.
- Últimos commits relevantes:
  - `85392c3` fix(billing): AsaasClient manda User-Agent, items e nextDueDate no checkout
  - `ffe0da2` / `6e318ff` landing de preços e FAQ dinâmica (início da Fase 3)
  - `e87c7d3` rascunho de Termos de Uso e Política de Reembolso (Fase 3)
  - `2bfc7e3` assinar, cancelar e regularizar pagamento em `/plano` (Fase 2)

## 3. Stack

- Backend: NestJS 11, Prisma 5.22, PostgreSQL, Redis + BullMQ, JWT (access + refresh em cookie), Swagger.
- Frontend: Angular 16 standalone, TypeScript, SCSS, PWA. Mobile via Capacitor (iOS).
- Infra local: Docker Compose (Postgres e Redis).
- Serviços externos: Asaas (cobrança), Resend (e-mail), SelahIA (gateway de IA, projeto vizinho em `codeStage/SelahIA`).
- Depende do SelahIA: `npm run dev` sobe também o SelahIA via `scripts/dev-selah.mjs` (porta 3010, reaproveita se já estiver rodando).

## 4. Como rodar

Variáveis de ambiente (só nomes; modelo em `.env.example`): `POSTGRES_*`, `DATABASE_URL`, `REDIS_URL`, `PORT`, `APP_URL`, `FRONTEND_URL`, `APP_CORS_ALLOWED_ORIGINS`, `BILLING_ENABLED`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AUTH_*` (cookie, MFA, links de e-mail), `SELAH_*`, `RESEND_*`, `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_TIMEOUT_MS`, `FRONTEND_APP_*`.

Comandos:
- Instalar: `npm install && npm --prefix backend install && npm --prefix frontend install`
- Desenvolvimento completo: `cp .env.example .env && npm run dev` (sobe Postgres, Redis, backend, frontend e SelahIA).
- Só infra: `npm run dev:infra`. Backend: `npm run dev:backend`. Frontend: `npm run dev:frontend`.
- Build: `npm run build`
- Testes do backend: `cd backend && npx jest` (unit) e `npm run test:e2e`.
- Migrations: `npm --prefix backend run prisma:migrate` (dev) e `prisma:deploy` (produção). Seed: `npm run db:seed`.
- Portas padrão no Docker Compose: Postgres 5433, Redis 6380, backend 3001, frontend 4201.

Números verdes verificados em 2026-11-15:
- Backend `npx jest`: 44 suites, 817 testes, todos passando.
- Frontend `npx ng test --watch=false --browsers=ChromeHeadlessCI`: 241 testes passando. `npm run build` sem erro.
- Backend `npx nest build`: sem erros.

Armadilhas:
- O `postinstall` do backend roda `prisma generate` lendo `../.env`. Sem `.env` na raiz a instalação falha.
- Existem containers `agilis-postgres` e `agilis-redis` rodando na máquina. São de outro projeto, não do Lumen.
- Versões desencontradas: `package.json` raiz 1.59.62, `backend/package.json` 1.59.63, README fala em 1.5.0. Não há fonte única de versão.

## 5. Planos

- Fonte única do billing: `docs/superpowers/specs/2026-09-27-billing-design.md` (desenho, decisões do dono, fases na seção 15).
- Planos de implementação: `docs/superpowers/plans/2026-09-27-billing-fase-0-1.md` e `2026-09-28-billing-fase-2.md`.
- Decisões do dono já tomadas: freemium; planos Grátis, Individual e Compartilhado (este só como estrutura, "em breve"); Individual R$ 14,90/mês ou R$ 149/ano; Compartilhado R$ 24,90/mês ou R$ 249/ano; limites do Grátis: 2 metas ativas, 1 reserva, 3 contas fixas, 2 parcelados, 5 perguntas ao Selah por mês; checkout hospedado no Asaas; sem trial; contas atuais escolhidas pelo dono ganham Individual "de fundador" sem data de fim.
- Catálogo e preços ficam em `backend/src/billing/plans.catalog.ts`; preços sobrescrevíveis por `BILLING_PRICE_*`.
- Nova direção de produto, ainda sem implementação: `docs/superpowers/plans/2026-11-14-assistente-manual-importacao-planos.md`. O lançamento deve desligar a LLM, priorizar assistente determinístico no app e WhatsApp, manter importação/insights sem LLM e revisar a escada de planos antes de ligar billing.
- Contrato do escopo “Finanças por conversa”: `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md`. O bot deve consultar e operar gastos, limites de cartão, metas, reservas, recorrências, parcelados, contas fixas, orçamentos e importação com revisão obrigatória; app, celular e WhatsApp usam o mesmo motor. Isolamento A/B/C é regra de segurança: identidade só vem de JWT ou vínculo WhatsApp validado, toda consulta fica no escopo do dono e os testes devem tentar acesso cruzado antes de liberar escrita por WhatsApp. A implementação ainda não começou. Contrato do item 1 (rotas, tabelas, estados, confirmação idempotente) aprovado pelo dono em 2026-11-15: `docs/superpowers/specs/2026-11-15-conversa-contrato-item-1.md`. Item 2a (backend do motor, canal APP) implementado e revisado em 2026-11-15, sem commit: `backend/src/conversation/`, migration `20261115120000_conversation_item_2`, 725 testes verdes, 8 mutantes de isolamento mortos, integração real com 2 usuários passou. Briefs e dúvidas em `.superpowers/sdd/conversa-item-2/`. Item 2b (tela dentro do chat do Selah, `assistant-page`) implementado e revisado em 2026-11-15, com teste em Chrome headless contra o backend real: manual primeiro, Selah só quando a resposta vem com `unrecognized: true`. Achados da revisão: (a) `gastei mercado` (sem valor) agora faz o bot perguntar "Quanto foi?" (campo pendente `amount`), corrigido; (b) o `resumo` com "Entradas R$ 0,00" vinha do mês calculado pelo fuso do servidor, que deixava de fora lançamentos do dia 1 (corrigido com `monthToDateUtc` em `recurrence.util.ts`; o fuso do servidor de produção não foi confirmado, e `assistant.service.ts:1033` e `:1050` têm o mesmo padrão e não foram analisados); (c) pendente: `.proto-button--ghost:hover` pinta o texto de branco no tema claro em outras telas (`frontend/src/styles.scss:806`). Item 3a (consultas: `o que vence`, `minhas parcelas`, `contas fixas`, `minhas metas`) implementado e revisado em 2026-11-15, com integração real contra o Postgres: reusa `RecurringTransactionsService`, `InstallmentsService` e `GoalsService`; toda leitura do motor passa por `runRead`, que vira `ERROR` genérico e registra só o id da intenção e `error.name`. Contrato em `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3a.md`; dúvidas em `.superpowers/sdd/conversa-item-3a/duvidas.md`. Ler pelo bot gera os lançamentos vencidos de contas fixas e parcelas, como a tela faz. Abertas: janela de 30 dias, envelopes fora do 3a, receitas fora de `o que vence`. Atenção: o banco local 5433 tem a migration `202604012145_auth_session_hardening` que não existe no repo. Decisão do dono em 2026-11-15: vários cartões nomeados ficam para depois do bot; o v0 usa o cartão único já existente (`CreditCycleService`).
- Documentação de produto: `docs/architecture.md`, `docs/design-system.md`, `docs/releases/`, `docs/runbooks/`, `docs/legal/`.

## 6. Onde parou

Fases do billing (spec, seção 15):
- Fase 0 (spike no sandbox do Asaas): feita.
- Fase 1 (núcleo sem cobrança, limites, `/plano`, concessões pelo admin): feita.
- Fase 2 (checkout, webhook, sync, cancelar, regularizar): feita no código e nos testes.
- Fase 3 (landing de preços, textos legais, avisos de upgrade): em andamento. Já existem a seção de preços e FAQ na landing, o toast com ação clicável no aviso de limite, e o rascunho dos Termos e da Política de Reembolso. Falta revisão dos textos legais, a passada final no sandbox real e ligar em produção.

Último trabalho: o commit `85392c3` corrigiu o `AsaasClient` (agora manda `User-Agent`, `items` e `nextDueDate` no checkout). Foi o que apareceu ao testar contra o Asaas de verdade.

Estado do ambiente: `BILLING_ENABLED=false` por padrão, então o comportamento em produção não mudou. Sem servidor do Lumen rodando agora.

NÃO verificado:
- Testes do frontend (`ng test`), build do frontend e lint. Não rodei nesta sessão.
- Comportamento no navegador real (`/plano`, landing, admin, tema claro/escuro, mobile).
- `POST /checkouts` do Asaas com `chargeTypes:['RECURRENT']` e `subscription:{cycle,value}` contra o sandbox real. O `85392c3` sugere que houve uma passada real, mas a spec ainda lista isso como pendência.
- Se o commit `85392c3` já foi enviado ao remoto (está 1 à frente localmente).

## 7. O que falta

Ordem sugerida:
1. Rodar `ng test` e o build do frontend, e olhar `/plano` e a landing no navegador.
2. Passada final no sandbox real do Asaas: checkout, webhook, cancelar, regularizar.
3. Dono revisar Termos de Uso e Política de Reembolso (idealmente com advogado). Depende do dono.
4. Dono abrir a conta de produção do Asaas (pode levar dias) e decidir CPF ou CNPJ/MEI. Depende de terceiro e do dono.
5. Atualizar a Política de Privacidade (o Asaas é operador dos dados de pagamento). A spec cita isso na Fase 3.
6. Escolher quais contas atuais ganham concessão de fundador (feito pela tela de admin). Depende do dono.
7. Ligar `BILLING_ENABLED=true` em produção. Só depois dos itens 2 a 5.
8. Projeto futuro: plano Compartilhado (membros, convites, dados compartilhados).

## 8. Desafios e riscos

Limitações aceitas da Fase 2 (spec, seção 16), para não serem redescobertas:
- Se `createCheckout` falhar depois de o Asaas já ter criado o checkout, o retry cria um checkout órfão lá. O checkout hospedado não aceita chave de idempotência.
- Se a `Subscription` local for criada mas `createCheckout` falhar, sobra uma linha `PENDING` órfã. É inerte: não concede nem bloqueia nada.
- Duas entregas realmente simultâneas do mesmo evento de webhook podem passar pela checagem de idempotência. A proteção cobre reentrega sequencial, que é o caso comum.
- Reembolso é manual, pelo painel do Asaas. O backend só reage ao evento `PAYMENT_REFUNDED`.

Outros pontos:
- Não está verificado se pagar a fatura em atraso pelo `invoiceUrl` atualiza o cartão do próximo ciclo ou só quita aquela cobrança. Não bloqueia, porque "cancelar e assinar de novo" sempre funciona.
- Regra de ouro do código: o resto do app só pergunta ao `EntitlementsService`. Ele não conhece o Asaas. Quebrar isso espalha a dependência.
- `reconcileSubscription` é usada pelo webhook e pelo `/billing/sync`. Os dois caminhos nunca devem divergir.

## 9. Decisões abertas do dono (perguntar, não decidir)

- Receber como CPF ou CNPJ/MEI no Asaas.
- Leitura de nota fiscal e importação de CSV entram nos limites? A nova proposta recomenda franquia de nota/imagem no Pro. Auditoria em 14/11 confirmou que `ImportsService.previewReceiptImport()` chama SelahIA; para lançar sem LLM, trocar essa extração por OCR/QR Code e parser estruturado, mantendo a revisão e comparações existentes.
- Aprovar a substituição futura da escada Grátis/Individual/Compartilhado por Grátis/Controle/Pro (mantendo Compartilhado como projeto separado) e definir preços/franquias depois de medir custo de OCR e WhatsApp.
- Teto de 300 perguntas/mês do Selah no Individual e tolerância de atraso de 7 dias: ainda são premissas.
- Quais contas atuais recebem a concessão de fundador.
- Quando ligar o billing em produção.

## 10. Regras do dono e convenções

- Nunca fazer push, deploy ou ligar `BILLING_ENABLED` em produção sem pedido explícito.
- Nunca pôr segredo, chave ou senha em chat, commit ou doc.
- Commits separados, com caminhos explícitos, nunca amend ou reset. Se aparecer `index.lock`, esperar e repetir.
- Respostas ao dono: curtas, objetivas, com recomendação clara (o dono tem TDAH).
- Subagentes: implementação com `haiku`, revisão e correção com `sonnet`, um por vez. Itens de segurança (auth, sessão, criptografia, dado clínico) exigem revisor.
- Depois de alterar código, rodar `graphify update .`. Há grafo em `graphify-out/`.
- Backend usa o padrão de espionar o método privado de request para testar clientes externos (`AsaasClient`, `MailService`).

## 11. Onde estão os detalhes

- Desenho e decisões do billing: `docs/superpowers/specs/2026-09-27-billing-design.md`
- Planos de implementação: `docs/superpowers/plans/`
- Arquitetura: `docs/architecture.md`
- Textos legais (rascunho): `docs/legal/termos-de-uso.md`, `docs/legal/politica-de-reembolso.md`
- Runbook: `docs/runbooks/confirmar-email-contas-antigas.md`
- Notas de versão: `docs/releases/`
- Grafo de código: `graphify-out/` (use `graphify query "<pergunta>"` antes de caçar no código)
- Catálogo de planos: `backend/src/billing/plans.catalog.ts`
