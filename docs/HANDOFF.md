# Handoff do Lumen

Última atualização: 2026-11-15. Escrito para quem nunca viu o projeto.

**Ponto de retomada imediato:** o 3b2b (conta fixa e compra parcelada por conversa) está implementado, revisado (mutantes, integração real e Chrome) e commitado. A revisão achou 1 bug real no frontend (resposta de 1 caractere, como "3" parcelas, ficava bloqueada pelo `minLength(2)` do formulário) e 9 lacunas de teste, todos corrigidos. O próximo item do roteiro é o 4 (importar nota fiscal por OCR/QR sem IA). Relatório: `.superpowers/sdd/conversa-item-3b2b/resultado-revisao.md`.

## 1. Projeto

Lumen é um SaaS de organização de vida, feito pela codeStage Soluções. Junta tarefas, dinheiro (lançamentos, metas, reservas, contas fixas, parcelados), lembretes e um assistente de IA (Selah) numa experiência só, mobile-first e offline-first. O público é pessoa física que quer clareza sobre o próprio dia e dinheiro.

Princípio que mais pesa nas decisões: privacidade e simplicidade. O app nunca vê nem guarda CPF ou dado de cartão (o pagamento é num checkout hospedado do Asaas). Exportar os próprios dados, MFA e ver/editar o que já existe nunca são limitados por plano. Ninguém perde dado ao cair de plano.

## 2. Repositório

- Caminho local: `/home/caminhao/coding/codeStage/Lumen`
- Remoto: `git@github.com:Jcamihao/Lumen.git`
- Branch principal: `master`.
- **Branch de trabalho** (2026-11-16): `feature/importar-nota-fiscal`, tipo funcionalidade, base `master` (`bbd8b49`, tag `v1.6.0`), ainda não enviada ao remoto, merge na `master` ainda não pedido. Item 4 do roteiro (importar nota fiscal sem IA). Contrato `docs/superpowers/specs/2026-11-16-conversa-contrato-item-4.md` **aprovado pelo dono em 2026-11-16**; D1 (notas reais) sem resposta, D4 e D7 abertas. Em andamento: fase 4.0 (medição de OCR/QR/PDF em ambiente descartável fora do repositório, sem dependência nova no projeto); nenhum código de produção escrito. Histórico: `fix/analise-gastos-fuso` e `feature/financas-por-conversa` foram mergeadas na `master` com `--no-ff` em 2026-11-16, continuam no remoto e não foram apagadas; a `master` local já continha os commits da feature antes do merge (feitos antes da regra de branches) e sua ponta não foi movida.
- Próxima feature ou correção: criar `feature/<nome>` ou `fix/<nome>` a partir da `master` atualizada, antes de escrever código, e registrar aqui.
- Convenção de commit: Conventional Commits em português (`feat(billing): ...`, `fix(billing): ...`, `docs: ...`, `refactor(backend): ...`).
- Estado do git em 2026-11-16: o 3b2a foi salvo em commits locais separados (backend de domínio, motor, frontend e documentação). O `origin/master` local já aponta para `2cf5fb2` (fim do 3b1): alguém fez push depois do 3b1 (não foi esta sessão); o `git status` mostra a branch alinhada a esse ponto, e os commits do 3b2a ficam à frente dele. Sem `git fetch` nesta etapa, então o estado real do remoto não foi reconferido. Os logs antigos do 2b e os do 3b2a em `.superpowers/sdd/` ficam fora dos commits de propósito.
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

Últimos números verdes verificados em 2026-11-16, no fechamento do 3b2b (conferência independente do agente principal):
- Backend `npx tsc --noEmit`: limpo. `npx jest`: 48 suites, 1188 testes passando. `npx nest build`: sem erros. Módulos conversation + recurring-transactions + installments: 633 testes em `TZ=UTC`, `America/Sao_Paulo` e `Asia/Tokyo`. Spec do motor rodado 15 vezes seguidas sem falha pelo agente principal (30 pelo revisor).
- Backend `src/conversation`, `src/envelopes`, `src/credit-cycle` e `src/dashboard`: 500 testes passando em UTC, America/Sao_Paulo e Asia/Tokyo.
- Frontend `npx ng test --watch=false --browsers=ChromeHeadlessCI`: 272 testes passando. `npm run build`: sem erros.
- Mutantes do 3b2b: 91 distintos nos 12 grupos do roteiro; 81 mortos de primeira, 9 sobreviventes reais (todos mortos depois de testes novos) e 1 equivalente documentado. Integração real em Postgres 16 e Redis descartáveis (concorrência, dois usuários, limite do plano ao abrir e ao confirmar, falhas controladas, fusos) e Chrome em 4 combinações (claro/escuro, 390 e 1280 px). Detalhes em `.superpowers/sdd/conversa-item-3b2b/resultado-revisao.md`.
- Lint recomendado temporário (3b1): 40 usos legados de `any` em conversation/goals, mesma quantidade do HEAD; o backend não tem configuração ESLint própria no repo e o script `lint` aponta para um arquivo que não existe. Nenhuma configuração foi criada.

Armadilhas:
- O `postinstall` do backend roda `prisma generate` lendo `../.env`. Sem `.env` na raiz a instalação falha.
- Existem containers `agilis-postgres` e `agilis-redis` rodando na máquina. São de outro projeto, não do Lumen.
- Versões desencontradas: `package.json` raiz 1.59.62, backend e frontend 1.59.63, README fala em 1.5.0. Não há fonte única de versão.

Ambiente de teste: a integração real do 3b2a rodou em contêineres descartáveis (`docker run --rm`: Postgres 16 em 55459 e Redis em 56409), com banco novo, as 26 migrations do repositório aplicadas e `prisma migrate diff` sem diferença. Backend de teste em 3999, front estático em 4399 (cópia do `dist` com `app-config.js` apontando para a API de teste), billing ligado só ali e sem checkout. Tudo foi removido no fim e as portas ficaram sem listener. Nunca confundir esse ambiente com o banco local antigo da porta 5433 (tem a migration `202604012145_auth_session_hardening`, ausente do repo).

A porta **55439 pertence ao Postgres do Bora** (dados reais em `coding/Leke/Bora/.git/codex-backups/new-modules-nest/postgres-data`) e a **3001 é de outro projeto**. Não parar, reutilizar nem migrar. Para integrações futuras, subir contêineres próprios em portas livres (conferir com `ss -ltn`) e usar banco novo, em vez do volume antigo. Falhas controladas (provisão, efeito auxiliar, commit desconhecido) foram injetadas por um bootstrap fora do repositório, sem derrubar serviços compartilhados.

Os scripts de `/tmp/lumen-3b2a.ZMPCGI` do handoff anterior não foram usados e podem ser descartados. Manter valores de credenciais fora dos documentos.

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
- Item 3b2: contrato em `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md`, validado explicitamente pelo dono em 15/11. Divide 3b2a (reservas e teto do ciclo) e 3b2b (contas fixas e compras parceladas), com vencimentos explícitos hoje/futuro e proteção pós-persistência antes das novas intenções. O **3b2a está implementado, revisado e commitado** (briefs, tipos, decisões e relatório em `.superpowers/sdd/conversa-item-3b2a/`, com `resultado-revisao.md`). O **3b2b está implementado e commitado** (briefs, tipos e decisões em `.superpowers/sdd/conversa-item-3b2b/`); revisado e corrigido (`resultado-revisao.md`).
- Isolamento A/B/C continua obrigatório: identidade vem do JWT ou vínculo WhatsApp validado; consultas e escritas usam o dono autenticado. O v0 usa o cartão único existente (`CreditCycleService`); vários cartões nomeados ficam para depois do bot, por decisão do dono em 15/11.
- Pendências históricas fora desta revisão: padrão de cálculo de mês em `assistant.service.ts` (o motor já usa `monthToDateUtc`), hover global de botão ghost no tema claro e migration `202604012145_auth_session_hardening` presente no banco antigo 5433 mas ausente do repo. A revisão atual não usou esse banco antigo.
- Documentação de produto: `docs/architecture.md`, `docs/design-system.md`, `docs/releases/`, `docs/runbooks/`, `docs/legal/`.

## 6. Onde parou

O foco atual é o bot financeiro, não o billing. O 3b1 está concluído nos commits `d1d2fa2`, `45604a1` e `2cf5fb2`. O 3b2a (reserva e limite do cartão) e o 3b2b (conta fixa e compra parcelada) estão concluídos e commitados em 2026-11-16. Os dois tiveram revisão completa com mutantes e integração real.

O que o 3b2a entregou e deve ser reaproveitado no 3b2b:
- Cada ação nova grava por um método interno do serviço de domínio que devolve um **recibo** do que foi persistido (`EnvelopesService.createForConversation`, `CreditCycleService.setCeilingForConversation`), compartilhando o núcleo de gravação com o método da tela. O bot nunca depende de uma agregação posterior para confirmar.
- Três resultados de gravação, que não se confundem: persistiu (`DONE`, com aviso se o efeito auxiliar pendente falhou); não persistiu comprovadamente (4xx descarta o rascunho, erro inesperado restaura); **commit de resultado desconhecido** (`ERROR`/`IDLE`, sem restaurar, sem liberar a `appliedKey`, orienta conferir a tela de Finanças). Mais a **condição revisável** (mês da reserva ou ciclo/teto/opção do cartão mudou): sem gravar, `version + 1`, 5 minutos novos e nova confirmação, com o motivo na linha "Atenção" de `rows`.
- O limite do cartão grava dentro de uma transação que bloqueia a linha do dono com `SELECT ... FOR NO KEY UPDATE`. A revisão tinha medido `FOR UPDATE` funcionando, e a troca para `FOR NO KEY UPDATE` foi feita pelo agente principal e conferida num Postgres descartável: serializa os escritores do teto e os `UPDATE` do usuário, e não bloqueia inserts de filhos do mesmo usuário.
- Cinco mudanças de comportamento HTTP nas telas, aceitas pelo agente principal: (A) `POST /envelopes` apara e valida o nome em 2 a 60 caracteres; (B) a provisão inicial entra na mesma transação do envelope; (C) `PUT /credit-cycle/ceiling` não vira 500 se a atualização de dados derivados falhar depois de gravar; (D) o teto grava em transação com bloqueio; (E) `POST /envelopes` também não vira 500 pela mesma falha auxiliar (responde 201). O formato das respostas das telas não regrediu (conferido na revisão).

Pendências e limites do 3b2a: o commit de resultado desconhecido não tem recuperação automática (só orienta conferir a tela); o rótulo "Lançado" do cartão aparece também para reserva e limite (texto de UX, `assistant-page.component.html:101`); a linha "Atenção" não tem destaque visual; a leitura `reservas` mostra envelopes e `metas` mostra metas (vocabulário corrigido no 3b1).

Próximo trabalho concreto: item 4 (nota fiscal por OCR/QR sem IA), ou o item 2e (mesmo padrão de data em `assistant.service.ts`), conforme o dono escolher.

O que o 3b2b entregou: `RECURRING` e `INSTALLMENT` como tipos de rascunho; `createForConversation` nos serviços de recorrências e parcelados, com recibo e os três resultados de gravação; condição revisável quando o primeiro vencimento já passou (sem gravação, versão + 1, nova confirmação); `write-body.parser.ts` para os corpos de comando; rótulo "Criado" no cartão de conclusão de conta fixa e parcelado. Três mudanças aceitas também nas telas: HTTP 201 em vez de 500 quando só uma etapa auxiliar falha depois de gravar; descrição aparada e validada (2 a 120 caracteres); parcela mínima de R$ 0,01 (rejeita parcela zero). Bloqueio do ciclo de cartão confirmado como `FOR NO KEY UPDATE`. Limites do parser: "seguro anual" vira frequência anual; "geladeira 1200 em 12x" mantém 1200 na descrição.

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
2. 3b2a e 3b2b (reserva, limite do cartão, conta fixa e compra parcelada) concluídos e commitados. Próximo: item 4 (nota fiscal sem IA),  Vários cartões nomeados ficam para depois do bot.
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

Na preparação do contrato 3b2, foram verificados riscos de falha em etapas posteriores à gravação nos serviços de envelopes, recorrências, parcelados e teto do ciclo; repetir um rascunho como se nada tivesse sido persistido pode duplicar o cadastro. Todos os quatro estão tratados (3b2a e 3b2b), incluindo a rejeição de parcela zero. 

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

- O contrato do 3b2 foi validado pelo dono em 15/11: duas entregas, vencimento explícito somente hoje/futuro, despesa recorrente mensal como padrão visível e categoria/pagamento pela tela no primeiro recorte. Essas escolhas não estão mais abertas; não pedir aprovação novamente. Mudança de escopo ou produto fora desse contrato deve voltar ao dono.

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
- Modelos nesta rodada: o 3b2a foi iniciado por outra sessão em que Haiku/Sonnet não estavam disponíveis (o backend parcial daquela etapa foi escrito por outro modelo e não validado). Na retomada de 2026-11-16, o fechamento do backend e o frontend foram desenvolvidos por subagentes `haiku` e a revisão por um subagente `sonnet`, com conferência independente do agente principal. O `sonnet` tem limite de uso de 5 horas: se um subagente parar por limite, ele avisa onde parou e a retomada continua dali.
- Depois de alterar código, rodar `graphify update .`. Há grafo em `graphify-out/`.
- `graphify update .` foi rodado em modo AST (sem LLM) no fechamento do 3b2b, depois do código final. Documentos não foram reprocessados semanticamente; os relatórios e este handoff são a fonte do estado da entrega.
- Teste intermitente do 3b2b: `evento não guarda a descrição nem o valor` (conta fixa) falhava em ~2 de 30 execuções porque o UUID aleatório do evento às vezes continha o texto "120". Corrigido ignorando `id`, `messageId` e `appliedKey` na checagem; 30 execuções seguidas passaram. Não era bug do produto.
- Backend usa o padrão de espionar o método privado de request para testar clientes externos (`AsaasClient`, `MailService`).

## 11. Onde estão os detalhes

- Contrato 3b2 aprovado: `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md`.
- 3b2a: briefs `.superpowers/sdd/conversa-item-3b2a/{brief-backend,brief-frontend,retomada-backend,revisao}.md`, tipos finais em `contrato-tipos.md`, decisões em `duvidas.md` e o relatório da revisão em `resultado-revisao.md` (mutantes, integração real, capturas). Logs de teste e de build dessa pasta e de `conversa-item-2b/` não são fonte e ficam fora dos commits.

- Desenho e decisões do billing: `docs/superpowers/specs/2026-09-27-billing-design.md`
- Planos de implementação: `docs/superpowers/plans/`
- Arquitetura: `docs/architecture.md`
- Textos legais (rascunho): `docs/legal/termos-de-uso.md`, `docs/legal/politica-de-reembolso.md`
- Runbook: `docs/runbooks/confirmar-email-contas-antigas.md`
- Notas de versão: `docs/releases/`
- Grafo de código: `graphify-out/` (use `graphify query "<pergunta>"` antes de caçar no código)
- Catálogo de planos: `backend/src/billing/plans.catalog.ts`

Limites do 3b2b registrados pela revisão: ESLint não roda (sem config no backend; `@typescript-eslint/parser` quebrado em `node_modules`); 2 imports sem uso anteriores ao 3b2b (`BadRequestException` em `conversation.service.ts`, `addDaysUtc` em `recurring-transactions.service.ts`); queda real do Postgres no meio do commit não foi provocada (o commit de resultado desconhecido foi simulado); dispositivo móvel real não testado.
