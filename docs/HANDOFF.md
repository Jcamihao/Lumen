# Handoff do Lumen

Última atualização: 2026-11-15. Escrito para quem nunca viu o projeto.

## 1. Projeto

Lumen é um SaaS de organização de vida, feito pela codeStage Soluções. Junta tarefas, dinheiro (lançamentos, metas, reservas, contas fixas, parcelados), lembretes e um assistente de IA (Selah) numa experiência só, mobile-first e offline-first. O público é pessoa física que quer clareza sobre o próprio dia e dinheiro.

Princípio que mais pesa nas decisões: privacidade e simplicidade. O app nunca vê nem guarda CPF ou dado de cartão (o pagamento é num checkout hospedado do Asaas). Exportar os próprios dados, MFA e ver/editar o que já existe nunca são limitados por plano. Ninguém perde dado ao cair de plano.

## 2. Repositório

- Caminho local: `/home/caminhao/coding/codeStage/Lumen`
- Remoto: `git@github.com:Jcamihao/Lumen.git`
- Branch principal: `master`.
- **Branch de trabalho** (2026-11-16): `fix/analise-gastos-fuso`, tipo correção, base `origin/master` (`2cf5fb2`), enviada ao remoto em 2026-11-16, **merge na `master` aguardando aprovação do dono**. Corrige o item 2e: `analyzeSpending` (`backend/src/assistant/assistant.service.ts`) usava o fuso do processo para o corte de 3 meses e para o índice do mês, o que excluía ou deslocava lançamentos do dia 1 em servidor fora de UTC. Agora usa o fuso do usuário só para o "mês atual" e getters UTC para o resto (mesma convenção do dashboard). Testes novos em `assistant.service.spec.ts`, verdes em UTC, America/Sao_Paulo e Asia/Tokyo e vermelhos com o código antigo. Backend: 45 suites, 966 testes, `tsc` e `nest build` ok. Versão e tag `vX.Y.Z` só depois do merge aprovado.
- Existe também a branch `feature/financas-por-conversa` (itens 1 a 3b2b do bot financeiro, 13 commits à frente da `origin/master`), com merge aguardando aprovação. O estado detalhado do bot está no HANDOFF dessa branch.
- Convenção de commit: Conventional Commits em português (`feat(billing): ...`, `fix(billing): ...`, `docs: ...`, `refactor(backend): ...`).
- Estado do git em 2026-11-15: o dono pediu os commits após a revisão. Backend e frontend do 3b1 foram commitados separadamente, e a documentação acompanha o commit de fechamento desta rodada. Restam fora dos commits apenas os logs antigos `.superpowers/sdd/conversa-item-2b/build-run.log` e `test-run.log`. Não houve push, deploy ou `git fetch`; a referência remota local não confirma o estado atual do servidor.
- Últimos commits relevantes:
  - `d1d2fa2` criação de metas e aportes confirmados com gravação atômica, incluindo testes do backend.
  - `45604a1` cartões genéricos de meta/aporte no chat, tipos e testes do frontend.
  - `87eb70e` brief do backend do item 3b1.
  - `d663cd3` contrato do item 3b1 (metas e aportes).
  - `05b4062` consultas de vencimentos, parcelas, contas fixas e metas (item 3a).
  - `85392c3` fix(billing): AsaasClient manda User-Agent, items e nextDueDate no checkout
  - `ffe0da2` / `6e318ff` landing de preços e FAQ dinâmica (início da Fase 3)
  - `e87c7d3` rascunho de Termos de Uso e Política de Reembolso (Fase 3)
  - `2bfc7e3` assinar, cancelar e regularizar pagamento em `/plano` (Fase 2)

## 3. Stack

- Backend: NestJS 11, Prisma 5.22, PostgreSQL, Redis + BullMQ, JWT (access + refresh em cookie), Swagger.
- Frontend: Angular 20.3 standalone (conferido no package.json), TypeScript 5.8, SCSS, PWA. Mobile via Capacitor 5 (iOS).
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
- Backend `npx jest`: 45 suites, 963 testes passando em UTC, America/Sao_Paulo e Asia/Tokyo na revisão do item 3b1. Conferência independente do agente principal: 7 suites, 381 testes de conversation e goals passando.
- Frontend `npx ng test --watch=false --browsers=ChromeHeadlessCI`: 248 testes passando na revisão do item 3b1.
- Backend `npx nest build`: sem erros.
- Frontend `npm run build`: sem erros.
- Mutantes de segurança/contrato: 14 variantes detectadas pelos testes, com fontes restauradas após cada uma.
- Lint recomendado temporário: 40 usos legados de `any` em conversation/goals, mesma quantidade do HEAD; sem essa regra, nenhum outro erro. O backend não tem configuração ESLint própria no repo; não foi criada uma nesta revisão.

Armadilhas:
- O `postinstall` do backend roda `prisma generate` lendo `../.env`. Sem `.env` na raiz a instalação falha.
- Existem containers `agilis-postgres` e `agilis-redis` rodando na máquina. São de outro projeto, não do Lumen.
- Versões desencontradas: `package.json` raiz 1.59.62, backend e frontend 1.59.63, README fala em 1.5.0. Não há fonte única de versão.

Na revisão de 15/11, Docker Desktop não oferecia engine utilizável e não havia Postgres/Redis do Lumen nas portas padrão. Foram usados serviços descartáveis em `/tmp/lumen-review-3b1.ugN48X`, com Postgres 16 em 55439, Redis em 56389, backend em 3999 e frontend em 4399. As 26 migrations do repositório foram aplicadas em banco novo e não houve diferença para o schema Prisma. Nunca confundir esse ambiente de teste com o banco local antigo em 5433.

## 5. Planos

- Fonte única do billing: `docs/superpowers/specs/2026-09-27-billing-design.md` (desenho, decisões do dono, fases na seção 15).
- Planos de implementação: `docs/superpowers/plans/2026-09-27-billing-fase-0-1.md` e `2026-09-28-billing-fase-2.md`.
- Decisões do dono já tomadas: freemium; planos Grátis, Individual e Compartilhado (este só como estrutura, "em breve"); Individual R$ 14,90/mês ou R$ 149/ano; Compartilhado R$ 24,90/mês ou R$ 249/ano; limites do Grátis: 2 metas ativas, 1 reserva, 3 contas fixas, 2 parcelados, 5 perguntas ao Selah por mês; checkout hospedado no Asaas; sem trial; contas atuais escolhidas pelo dono ganham Individual "de fundador" sem data de fim.
- Catálogo e preços ficam em `backend/src/billing/plans.catalog.ts`; preços sobrescrevíveis por `BILLING_PRICE_*`.
- Direção de produto: `docs/superpowers/plans/2026-11-14-assistente-manual-importacao-planos.md`. O assistente determinístico no app já está em implementação; desligamento final da LLM, WhatsApp, importação sem LLM e revisão de planos continuam pendentes.
- Fonte única da ordem do bot: `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md`, seção “Ordem de implementação”. Contrato do item 1: `docs/superpowers/specs/2026-11-15-conversa-contrato-item-1.md` (estados, DTOs, confirmação idempotente).
- Itens 2a/2b/2c: motor APP, integração ao chat e coleta de valor implementados e commitados. O chat tenta o motor determinístico primeiro e só encaminha ao Selah quando recebe `unrecognized: true`.
- Item 3a: consultas de vencimentos, parcelas, contas fixas e metas implementadas e commitadas; contrato `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3a.md`. Leituras reutilizam os serviços existentes; as materializações de recorrências/parcelas têm o mesmo efeito de abrir a tela. Janela de vencimentos de 30 dias, somente despesas.
- Item 3b1: metas/cofrinhos, aportes confirmados, reservas como envelopes e cartões genéricos implementados, revisados e commitados; contrato `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b1.md`. Detalhes na seção 6 e em `.superpowers/sdd/conversa-item-3b1/`.
- Isolamento A/B/C continua obrigatório: identidade vem do JWT ou vínculo WhatsApp validado; consultas e escritas usam o dono autenticado. O v0 usa o cartão único existente (`CreditCycleService`); vários cartões nomeados ficam para depois do bot, por decisão do dono em 15/11.
- Pendências históricas fora desta revisão: padrão de cálculo de mês em `assistant.service.ts` (o motor já usa `monthToDateUtc`), hover global de botão ghost no tema claro e migration `202604012145_auth_session_hardening` presente no banco antigo 5433 mas ausente do repo. A revisão atual não usou esse banco antigo.
- Documentação de produto: `docs/architecture.md`, `docs/design-system.md`, `docs/releases/`, `docs/runbooks/`, `docs/legal/`.

## 6. Onde parou

O foco atual é o bot financeiro, não o billing. O item 3a foi concluído no commit `05b4062`. O item 3b1 está implementado e passou pela revisão técnica: criar metas/cofrinhos, aportar com rascunho e confirmação, consultar reservas como envelopes e exibir os cartões genéricos no frontend. O código foi salvo nos commits `d1d2fa2` e `45604a1`, a pedido do dono após a revisão. O próximo item funcional é o contrato do 3b2.

Foram corrigidos na revisão: aviso de conclusão escondido no cartão; seleção numérica mudando de destino quando uma meta ficava indisponível; lacuna de teste do limite de cinco reservas no payload; gravação parcial do aporte. O dono autorizou ampliar a revisão para `GoalsService`: saldo e transferência agora usam a mesma transação com bloqueio da meta do dono, e falhas auxiliares após o commit não provocam erro financeiro nem nova tentativa do aporte.

O agente principal validou API, Postgres real e Chrome headless com duas contas sintéticas. Confirmar em paralelo criou uma meta; repetir confirmação não duplicou aporte; o plano Grátis recusou a terceira meta; isolamento, cancelamento, meta apagada, restauração e cartões claro/escuro em 390/1280 px passaram. A falha controlada da transferência reverteu o saldo; a repetição gravou uma vez. Oito aportes distintos simultâneos preservaram a soma correta. Não houve chamada à LLM, checkout ou produção.

Detalhes e limitações: `.superpowers/sdd/conversa-item-3b1/resultado-revisao.md` (revisor) e `conferencia-principal.md` (verificação independente). `revisao.md` continua sendo o brief, não o relatório. Sonnet não estava disponível nesta sessão; o modelo disponível executou a revisão com conferência do agente principal.

O histórico abaixo descreve o billing, que não foi revalidado nesta revisão.

Fases do billing (spec, seção 15):
- Fase 0 (spike no sandbox do Asaas): feita.
- Fase 1 (núcleo sem cobrança, limites, `/plano`, concessões pelo admin): feita.
- Fase 2 (checkout, webhook, sync, cancelar, regularizar): feita no código e nos testes.
- Fase 3 (landing de preços, textos legais, avisos de upgrade): em andamento. Já existem a seção de preços e FAQ na landing, o toast com ação clicável no aviso de limite, e o rascunho dos Termos e da Política de Reembolso. Falta revisão dos textos legais, a passada final no sandbox real e ligar em produção.

Último trabalho de billing: o commit `85392c3` corrigiu o `AsaasClient` (manda `User-Agent`, `items` e `nextDueDate` no checkout). O trabalho mais recente do projeto é a revisão do item 3b1 descrita acima.

Estado da configuração: `BILLING_ENABLED=false` continua como padrão. Somente a API descartável da revisão usou billing ligado para conferir os limites do Grátis, sem editar `.env` nem iniciar checkout.

Estado final do ambiente de revisão: API, servidor estático, Chrome, Postgres e Redis temporários encerrados. As portas 3999/4399/55439/56389 foram conferidas sem listeners. Contas, metas e transações de teste foram removidas, e o Redis descartável ficou sem chaves. Scripts, resultados e capturas continuam em `/tmp/lumen-review-3b1.ugN48X`, sujeitos à limpeza normal de `/tmp`; os relatórios persistentes no projeto são a fonte para retomar.

NÃO verificado:
- Esta revisão cobriu o chat; `/plano`, landing e admin não foram revalidados.
- Dispositivo físico e queda real de Postgres/Redis não foram testados. As falhas financeiras foram injetadas dentro de transações reais, sem derrubar serviços.
- `POST /checkouts` do Asaas com `chargeTypes:['RECURRENT']` e `subscription:{cycle,value}` contra o sandbox real. O `85392c3` sugere que houve uma passada real, mas a spec ainda lista isso como pendência.
- Estado atual do remoto: não houve `git fetch`; os commits desta rodada continuam somente locais, sem push.

## 7. O que falta

Ordem atual do bot, conforme `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md` e o recorte 3b1:
1. Revisão do 3b1 concluída e código commitado a pedido do dono; documentação incluída no fechamento desta rodada. Push continua dependendo de pedido explícito.
2. Definir e implementar o 3b2: criação de reservas/envelopes, contas fixas, parcelados e limite do cartão. Vários cartões nomeados ficam para depois do bot.
3. Item 4: substituir extração de nota por OCR/QR, com prévia e revisão.
4. Itens 5/6: adaptador WhatsApp, vínculo validado e testes de isolamento A/B/C antes de habilitar escrita.
5. Item 7: fallback de IA por entitlement/crédito, sem escrita por IA.
6. Item 8: edição e exclusão explícitas por conversa.

Pendências de billing, a retomar depois da prioridade atual e das decisões do dono:
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
- Após criar meta/aportar, uma falha auxiliar de notificação ou atualização de cache é registrada sem dados financeiros e não desfaz o sucesso financeiro. Sem outbox/retry persistente, esse efeito auxiliar pode ficar desatualizado até um próximo processamento; não se deve repetir o aporte por isso.
- O contrato de confirmação mantém o limite existente de perder o rascunho se o processo cair entre reivindicá-lo e aplicar a ação. Edição/saque e outros fluxos fora do 3b1 não foram incluídos na correção transacional do aporte.

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
- Nesta revisão, `graphify update .` foi concluído em modo AST, sem LLM: 4.003 nós e 9.292 arestas. Documentos não foram reprocessados semanticamente; os relatórios e este handoff são a fonte do estado atual da entrega.
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
