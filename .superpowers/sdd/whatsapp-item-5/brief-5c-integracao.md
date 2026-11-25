# Brief 5c: integração real do conjunto WhatsApp (subagente sonnet)

Você prova que front (cartão 5b) + backend real (5a) + Postgres + Redis + WA-AKG falso funcionam juntos, **no navegador de verdade**, **corrige** o que quebrar e relata. Relate em caveman terse (português); código, comentários, commits e documentos em prosa normal.

## Contexto

- Repositório `/home/caminhao/coding/codeStage/Lumen`, branch `feat/whatsapp-adapter` (confira com `git branch --show-current`; outra = pare e avise). 5a (backend) e 5b (front) já foram desenvolvidos e revisados separadamente; só faltava rodá-los juntos. Nada foi testado ainda com o front falando com o backend real.
- Leia: `docs/superpowers/specs/2026-11-18-conversa-contrato-item-5.md`, `.superpowers/sdd/whatsapp-item-5/resultado-rev-5a.md` (seção "Integração real": é o roteiro que você reaproveita; o ambiente descrito lá serve de modelo) e `resultado-rev-5b.md`.
- WA-AKG falso: `.superpowers/sdd/whatsapp-item-5/fake-wa-akg.mjs` (uso no topo do arquivo). **Não toque** em `/home/caminhao/coding/codeStage/wa-akg` (o real).
- Use `graphify query` antes de varrer arquivos.

## Ambiente (tudo no scratchpad; nada disso entra no repositório)

- Docker: containers descartáveis **novos** (`lumen-w5c-pg` Postgres 16, `lumen-w5c-redis` Redis 7) em portas livres que você escolher (confira com `ss -ltn`). **Nunca toque** em `agilis-postgres`, `agilis-redis`, `habblaud` nem em outros containers. Se o Docker não responder, pare e avise.
- Backend: `nest build`, copie `backend/dist` para uma pasta do scratchpad com `.env` **duas pastas acima do dist** (o `ConfigModule` lê `resolve(__dirname, "../../.env")`) e `node_modules` por symlink. `.env` próprio com segredos de teste inventados: **nunca** copie o `.env` real da raiz (tem chaves reais Selah/Resend). Variáveis: banco e Redis dos containers, `WHATSAPP_ENABLED=true`, `WHATSAPP_WRITES_ENABLED` (alternar false e true), `WA_AKG_BASE_URL`, `WA_AKG_API_KEY`, `WA_AKG_SESSION_ID`, `WA_AKG_WEBHOOK_SECRET`, `WHATSAPP_CONTACT_NUMBER` (ex. `5511999990000`), origem CORS do front (descubra o nome da variável no backend), e o que mais o boot exigir (JWT etc., valores de teste). `prisma migrate deploy` com as 28 migrations.
- Front: `npm run build` no `frontend`; sirva `frontend/dist/frontend` com servidor estático (fallback para `index.html`) e um `assets/app-config.js` (só na cópia do scratchpad) com `apiBaseUrl` e `wsBaseUrl` do backend de teste. Ache o formato certo em `frontend/src/assets/app-config.js` ou onde o projeto o define.
- Navegador: Chrome do Playwright em `/home/caminhao/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` (use o módulo playwright/puppeteer que já existir na máquina; sem instalar nada no repositório).
- Máximo 2 processos pesados ao mesmo tempo. Nunca `pkill -f` (mate por PID de `ss -ltnp`). Ao final derrube servidores e containers `lumen-w5c-*` e apague o scratchpad que criou.

## Roteiro (cada passo: dizer "passou" ou o que quebrou, com evidência)

Contas A e B criadas pela UI ou pela API (`privacyNoticeAccepted: true`), login pela UI no navegador.

1. **Cartão com tudo ligado**: Configurações > Conta mostra o cartão "WhatsApp" no estado "não vinculado", consentimento visível antes do botão. Com `WHATSAPP_ENABLED=false` (reinicie o backend): estado "desligado", sem botão. Volte para true.
2. **Vincular de ponta a ponta**: A clica "Gerar código de vínculo"; o código aparece formatado com prazo e o número do Lumen (`contactNumber`) formatado; o teste "envia" o código pelo falso (`/_fake/deliver` com o JID de A, assinado) **sem recarregar a página**; em até ~5 s o cartão troca para "vinculado" com número mascarado e toast; o falso recebeu a mensagem de confirmação. Confira no banco: só o hash, vínculo com o `userId` de A.
3. **Conversar**: do JID de A: "50 mercado" monta rascunho; "confirmar" com `WRITES=false` não grava e responde "confirme no app"; abra o app (aba Assistente) como A e confirme pelo botão: grava. Reinicie com `WRITES=true`: "confirmar" pelo WhatsApp grava 1 transação no usuário certo. `saldo` responde. Tudo na conta certa e **nada** em B.
4. **Isolamento visível**: B vincula outro JID. As respostas de cada JID só vão para o JID certo (olhe `/_fake/sent`). Mensagem do JID de A nunca aparece nas transações de B.
5. **Desvincular pela UI**: A clica "Desvincular", confirma em duas etapas; cartão volta a "não vinculado"; no banco, vínculo e sessão `WHATSAPP` somem e a sessão `APP` de A fica; o JID de A agora recebe só a orientação (uma vez por hora). Re-vincular funciona.
6. **Erros pela UI**: gerar 6 códigos seguidos → 429 → texto de limite no cartão. Código expirado (ajuste o prazo no banco para o passado): cartão mostra "expirado" e "Gerar novo código" (e o código expirado enviado pelo falso é recusado). Conta já vinculada gerando código por outra aba (409) → cartão recarrega e mostra vinculado.
7. **Cabeçalhos e CORS reais**: as chamadas do front ao backend passam (sem erro de CORS no console), o webhook **não** depende de CORS, e nenhuma resposta `/whatsapp/*` vaza `rawBody`, hash ou JID inteiro. Console do navegador sem erros nem warnings novos nas telas visitadas.
8. **Privacidade**: o código de vínculo não aparece em `localStorage`, `sessionStorage`, URL, nem nos logs do backend e do falso; `grep` nos logs por texto de mensagem, código, chave de API e segredo do webhook: zero ocorrências.
9. **Capturas** (olhe as imagens, não só salve): cartão em cada estado com o backend real, 360 px e desktop, claro e escuro. Descreva o que viu e qualquer defeito visual.

Se algo quebrar: ache a causa raiz, corrija (back ou front), escreva teste que cobre, rode de novo o passo e relate. Mudança de contrato (rota, corpo, resposta): pare e escreva em `.superpowers/sdd/whatsapp-item-5/duvidas.md`, sem inventar.

## Verificação final e entrega

Rode e relate números: `npx tsc --noEmit` e `npx jest --maxWorkers=2` no `backend`; `npx tsc --noEmit -p tsconfig.app.json`, `ng test` headless (comando do brief 5b) e `npm run build` no `frontend`. Tudo verde antes de commitar.

Commits pequenos, caminhos explícitos (nunca `git add -A`, nunca amend/reset; `index.lock` = esperar e repetir), prefixo convencional em português, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Não faça push. Não commite logs, `.env`, capturas nem nada do scratchpad.

Escreva `.superpowers/sdd/whatsapp-item-5/resultado-5c.md`: cada passo do roteiro com resultado e evidência, defeitos achados e o que mudou, números verdes, o que NÃO verificou (ex.: HTTPS público, WA-AKG real, Safari/iOS, celular real). Responda com resumo curto.
