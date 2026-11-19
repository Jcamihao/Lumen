# Resultado do 5c: integração real do conjunto WhatsApp

Branch: `feat/whatsapp-adapter`. Executor: sonnet. Sem push. Nada do repositório do WA-AKG real foi tocado.

## Ambiente

- Containers descartáveis `lumen-w5c-pg` (Postgres 16, 55441) e `lumen-w5c-redis` (Redis 7, 56441); `prisma migrate deploy` aplicou as 28 migrations (a última é `whatsapp_link`).
- Backend: `nest build`, cópia do `dist` no scratchpad com `.env` próprio (segredos de teste inventados) duas pastas acima, `node_modules` por symlink, porta 3491. WA-AKG falso (`fake-wa-akg.mjs`) na 3492.
- Front: `npm run build` e `dist/frontend` servido por servidor estático com fallback para `index.html` (4291) e `assets/app-config.js` só da cópia, apontando para o backend de teste. CORS liberado só para `http://127.0.0.1:4291` (`APP_CORS_ALLOWED_ORIGINS`).
- Navegador: Chrome do Playwright (chromium-1243) dirigido por `playwright-core` já existente na máquina (`/home/caminhao/habblaud/node_modules`), nada instalado no repositório.
- Contas A, B e C criadas pela API com `privacyNoticeAccepted: true`; login sempre pela UI. O `RateLimitGuard` de login (8 por 10 min) estourou durante os testes; apaguei só as chaves `auth-login` e `whatsapp-link-code` do Redis de teste quando precisei.

## Roteiro

1. **Cartão com tudo ligado: passou.** Configurações > Conta mostra "Nenhum WhatsApp vinculado a esta conta", o texto de consentimento (conexão não oficial, canal de terceiros) e só depois o botão "Gerar código de vínculo". Com `WHATSAPP_ENABLED=false` (backend reiniciado): "O WhatsApp ainda não está disponível nesta conta.", sem botão. Voltou a true.
2. **Vincular de ponta a ponta: passou.** A gera código (`A2KQ-3GS8`, 8 caracteres formatados, "Vale até 21:44 (faltam 11 min)", destino `+55 11 99999-0000` formatado). O teste enviou o código (em minúsculas) pelo `/_fake/deliver` assinado, sem recarregar (marcador de `window` intacto). O cartão virou "vinculado: +55 11 *****-0001" em 4,9 s, com toast "WhatsApp vinculado". O falso recebeu a confirmação ("Pronto! Este número está vinculado..."). Banco: `WhatsappLinkCode.codeHash` = SHA-256 do código (conferi `sha256("A2KQ3GS8")`), `usedAt` preenchido; `WhatsappLink.userId` = A, `jid` de A.
3. **Conversar: passou, com um achado de produto (ver "Defeitos").** "50 mercado" monta rascunho (pede categoria; "sem categoria" completa). Com `WRITES=false`, "confirmar" não grava (0 transações) e responde "Para gravar, confirme no app...". Pelo app: digitado "70 farmacia" + "sem categoria" + botão Confirmar na aba Assistente gravou (1 transação de A). O rascunho que veio do WhatsApp **não aparece** no app (`GET /conversation/session` devolve `IDLE`), então não dá para tocar Confirmar nele (duvidas.md item 9); confirmei esse rascunho por `POST /conversation/confirm` com o `draftId` e gravou no usuário certo. Com `WRITES=true`: "40 padaria", "sem categoria", "confirmar" gravou 1 transação de A; `saldo` respondeu "Saldo atual: -R$ 160,00" (70 + 50 + 40). Nada em B.
4. **Isolamento visível: passou.** B vinculou outro JID pela UI, fez "25 uber", confirmou e consultou saldo (-R$ 25,00). `/_fake/sent`: cada resposta saiu só para o JID certo (A recebeu o próprio saldo de -R$ 160,00). Banco: 3 transações de A, 1 de B; nenhuma mensagem de A foi parar em B.
5. **Desvincular pela UI: passou.** Com sessões `WHATSAPP` e `APP` de A em `COLLECTING_FIELDS`, A clicou "Desvincular", depois "Confirmar desvínculo" (duas etapas). Cartão voltou a "não vinculado". Banco: vínculo de A sumiu (B ficou), sessão `WHATSAPP` de A sumiu, sessão `APP` de A ficou. O JID de A mandou "saldo", "saldo", "oi": o falso recebeu 1 só orientação. Re-vincular funcionou.
6. **Erros pela UI: passou.** (a) 6 gerações seguidas (conta C, recarregando entre elas): 5 deram 201, a 6ª deu 429 e o cartão mostrou "Muitos códigos gerados. Tente de novo em uma hora." (b) Código expirado: com o relógio do Chrome avançado 11 min o cartão mostrou "Código expirado." e "Gerar novo código"; com `expiresAt` no passado no banco, o código enviado pelo falso foi recusado ("Não consegui validar este código...") e não criou vínculo. (c) 409: A não vinculada com o cartão aberto, A vinculada por "outra aba" (API + falso), clique em Gerar: `POST /link-code` 409 e o cartão recarregou o status e mostrou "vinculado".
7. **Cabeçalhos e CORS reais: passou.** Pré-voo `OPTIONS /whatsapp/link-code` da origem do front: 204 com `Access-Control-Allow-Origin: http://127.0.0.1:4291`. Origem estranha: 404 sem cabeçalhos CORS. `GET /status`, `POST /link-code` e `DELETE /link` com a origem do front trazem ACAO e `Allow-Credentials`. O webhook assinado chegou com `Origin: http://evil.test` e respondeu 200 sem ACAO (não depende de CORS); sem assinatura, 401. Corpos de `/whatsapp/*` (status, link-code, 429, 401) sem `rawBody`, hash nem JID: o status vinculado traz só `maskedNumber`. Console do navegador sem erros nem warnings nas telas visitadas (/dashboard, /settings > Conta, /assistant, /finance, /tasks, /goals). Os únicos registros do Chrome foram a linha nativa "Failed to load resource... 429/409" quando o próprio teste provocou esses status (esperado) e `ERR_ABORTED` do vídeo de fundo da tela de login quando o teste navegou antes de acabar de carregar.
8. **Privacidade: passou.** O código de vínculo não está em `localStorage`, `sessionStorage`, `window.name`, URL, cookies nem IndexedDB (nenhum banco), antes nem depois de vincular; texto de mensagem (`textoprivadozz`) também não. Os logs do backend (1045 linhas) e do falso: 0 ocorrências de código (dois conhecidos e o regex de código de vínculo), `w5c-chave-akg` (chave de API), `w5c-segredo-webhook`, `w5c-teste` (segredos JWT), `X-API-Key`, `x-webhook-signature`, `sha256=`, `rawBody`, hash do código, texto de mensagem ("50 mercado", mercado, padaria, farmacia, uber, "sem categoria", "30 teste", "15 cafe"), `5511912340`, `@s.whatsapp.net`, valores ("50,00") e respostas ("Saldo atual"). O Redis só tem chaves `whatsapp:*` por hash de JID.
9. **Capturas: feitas e olhadas.** 28 capturas do cartão (desligado, não vinculado, código, expirado, limite 429, vinculado, confirmando desvínculo) em 360 px e desktop (1280), claro e escuro, mais capturas de página inteira a 360x1100. O tema escuro foi confirmado pelo atributo `data-theme="dark"` em cada corrida. Vi: títulos e textos legíveis nos dois temas, erro em vermelho do tema, botão "Confirmar desvínculo" com destaque de perigo, código em uma linha a 360 px, nenhuma rolagem horizontal visível. Defeito visual achado e corrigido: ver abaixo. Capturas ficaram só no scratchpad (apagado).

## Defeitos achados e o que mudou

1. **Visual (corrigido).** Em 360 px o número mascarado quebrava no meio ("+55 11" / "*****-0002") no cartão vinculado, e o número do Lumen podia quebrar do mesmo jeito na instrução do código. Corrigido: número em `<span class="whatsapp-card__number">` com `white-space: nowrap`. Teste: asserções novas nos testes do cartão (span com o número inteiro nos estados vinculado e com código). Visto de novo no Chrome: o número agora cai inteiro para a linha de baixo.
2. **Texto errado do WhatsApp (corrigido).** As orientações diziam "Configurações > WhatsApp", mas o cartão fica em Configurações > Conta. Agora "Configurações > Conta > WhatsApp" em `linkFailed` e `hint` (`whatsapp-adapter.service.ts`). Teste novo no spec do adaptador.
3. **"Confirme no app" não funciona para rascunho do WhatsApp (NÃO corrigido, decisão do dono).** Detalhe, opções e recomendação em `duvidas.md`, item 9. Muda contrato (resposta de `GET /conversation/session`) ou o texto contratado, então parei conforme o brief.
4. Observação sem ação: a data do rascunho aparece como `18/11/2026` na pergunta de categoria e `2026-11-18` no rascunho final (vem do motor). `duvidas.md`, item 10.

## Números verdes (depois das correções)

- Backend: `npx tsc --noEmit` 0 erros; `npx jest --maxWorkers=2`: 59 suítes, 1526 testes, todos passando (1525 antes, +1).
- Frontend: `npx tsc --noEmit -p tsconfig.app.json` limpo; `ng test --watch=false --browsers=ChromeHeadlessCI`: 349 de 349 (as asserções novas entraram em testes existentes, por isso o total não mudou); `npm run build` ok.
- Lint: nenhum dos dois projetos tem script/configuração de lint (já era assim em 5a e 5b).

## NÃO verificado

- WA-AKG real, HTTPS público, domínio e webhook cadastrado no WA-AKG (o falso assina como o real, mas o formato vem da leitura do código do WA-AKG).
- Safari, iOS, celular real, teclado virtual, leitor de tela.
- Redis que cai com o backend já no ar (risco já registrado no 5a).
- Corrida de duas mensagens simultâneas do mesmo usuário.
- Clipboard real (botão Copiar não foi clicado no Chrome).
- Contraste medido por calculadora; só a olho.
- Teste A/B/C completo e revisão de segurança final: item 6.
- Fuso: o relógio do Chrome do teste foi o do sistema; matriz de fuso só nos testes unitários do 5a.
