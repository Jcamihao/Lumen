# Brief 5b: cartão "WhatsApp" em Configurações (subagente haiku)

Você implementa o front do vínculo de WhatsApp do Lumen, com testes. Relate em caveman terse (português); código, comentários e commits em prosa normal.

## Antes de começar

- Repositório `/home/caminhao/coding/codeStage/Lumen`, branch `feat/whatsapp-adapter` (confira com `git branch --show-current`; outra = pare e avise). Mexa SÓ em `frontend/`. Backend já está pronto e revisado: não toque.
- Leia: `docs/superpowers/specs/2026-11-18-conversa-contrato-item-5.md` (seções 5, 6 e 11; é o contrato), `frontend/src/app/core/services/conversation-api.service.ts` (padrão de service HTTP e do spec ao lado), `frontend/src/app/core/models/conversation.models.ts`, `frontend/src/app/features/settings/settings-page/settings-page.component.{ts,html,scss}` (aba "Conta", classe `proto-surface`), `frontend/src/app/core/services/toast.service.ts`.
- Use `graphify query "<pergunta>"` antes de varrer arquivos.

## Contrato da API (já implementado no backend; base `${environment.apiBaseUrl}/whatsapp`, usuário logado)

| Chamada | Resposta |
|---|---|
| `GET /whatsapp/status` | `{ enabled: boolean, linked: boolean, linkedAt?: string (ISO), maskedNumber?: string, contactNumber?: string }`. `maskedNumber` vem pronto (`+55 11 *****-1234`). `contactNumber` só existe se `enabled` e se o servidor tem o número configurado. |
| `POST /whatsapp/link-code` | `201 { code: string (8 chars, ex. "K7M2QX9P"), expiresAt: string (ISO, 10 min) }`. Erros: `409 { code: "WHATSAPP_ALREADY_LINKED" }`, `503 { code: "WHATSAPP_DISABLED" }`, `429` (limite de 5 códigos por hora). |
| `DELETE /whatsapp/link` | `204`, idempotente. |

## O que criar

1. `core/models/whatsapp.models.ts`: tipos `WhatsappStatus` e `WhatsappLinkCode`.
2. `core/services/whatsapp-api.service.ts` (+ spec): `getStatus()`, `createLinkCode()`, `unlink()`. Sem cache, sem offline, nada no navegador.
3. Componente standalone novo `features/settings/whatsapp-card/whatsapp-card.component.{ts,html,scss}` (+ spec), OnPush, signals, usado dentro da aba "Conta" de `settings-page.component.html` (no fim da aba, mesma linguagem visual dos outros blocos; só inclua `<app-whatsapp-card />` e o import na página). Estados:
   - **Carregando**: texto curto, sem pular layout.
   - **Desligado pelo servidor** (`enabled=false`, ou 503): "O WhatsApp ainda não está disponível nesta conta." Sem botão.
   - **Não vinculado**: texto de consentimento visível ANTES do botão (veja abaixo) e botão "Gerar código de vínculo".
   - **Código gerado**: mostrar o código em duas metades legíveis (`K7M2-QX9P`, fonte monoespaçada grande, com botão "Copiar" usando `navigator.clipboard` com tratamento de falha), prazo ("Vale até HH:mm", hora local) e contagem regressiva por minuto; instrução: "Envie este código, só ele, no WhatsApp para <contactNumber formatado>". Sem `contactNumber`: "...para o número do Lumen". Ao expirar: mensagem "Código expirado" e botão "Gerar novo código". Enquanto o código está visível, consultar `GET /whatsapp/status` a cada 5 s (e parar ao vincular, ao expirar e no `ngOnDestroy`/`DestroyRef`); ao ver `linked=true`, trocar para o estado vinculado e avisar com toast "WhatsApp vinculado".
   - **Vinculado**: "WhatsApp vinculado: <maskedNumber>" e "desde <data>"; botão "Desvincular" com confirmação em duas etapas (botão vira "Confirmar desvínculo" + "Cancelar"; nada de `window.confirm`). Após 204, voltar ao estado não vinculado e toast "WhatsApp desvinculado".
   - **Erros**: 409 → recarregar status (já está vinculado); 429 → "Muitos códigos gerados. Tente de novo em uma hora."; demais → "Não foi possível agora. Tente de novo." com botão "Tentar de novo". Nunca mostrar corpo bruto do erro.
   - Botões ficam desabilitados enquanto a chamada roda (sem duplo clique).

## Textos

- Consentimento (antes de gerar): "Ao vincular, você conversa com o Lumen pelo WhatsApp. O WhatsApp é um canal de terceiros: o texto das suas mensagens passa por ele. Por enquanto, pelo WhatsApp o Lumen só monta rascunhos e consulta; para lançar de fato, confirme no app. Você pode desvincular quando quiser." (Se o texto ficar longo demais no celular, quebre em dois parágrafos; não corte conteúdo.)
- Tom do Lumen: direto, sem exclamação, sem gíria.
- Acentuação correta em todo texto visível.

## Regras de qualidade

- Sem `any`. Sem `console.log`. Sem dependência nova.
- Claro e escuro: use as variáveis CSS que o projeto já usa (olhe o scss da página); proibido cor fixa que quebre um dos temas.
- 360 px sem rolagem horizontal; alvo de toque ≥ 44 px; foco visível; o código tem `aria-label` que o soletra ("K 7 M 2 Q X 9 P"); mudanças de estado anunciadas com `aria-live="polite"`.
- O código de vínculo é segredo de curta duração: não guardar em `localStorage`, não pôr em URL, não logar, e limpar do estado ao vincular, ao expirar e ao destruir.
- Timers (contagem e polling) param no destroy; teste com `fakeAsync`/`jasmine.clock` conforme o padrão do projeto.

## Testes obrigatórios (spec do service e do componente)

Service: URLs e métodos corretos. Componente: carregando, desligado (`enabled=false` e 503), não vinculado mostra consentimento antes do botão, gerar código mostra formatado e prazo, copiar (sucesso e falha), expiração troca o estado, polling detecta vínculo e para, polling para ao destruir, desvincular em duas etapas e cancelar, 409, 429, erro genérico com "Tentar de novo", botão desabilitado durante a chamada.

## Como rodar e entregar

```
cd frontend
npx tsc --noEmit -p tsconfig.app.json
PUPPETEER_EXECUTABLE_PATH=/home/caminhao/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome CHROME_BIN=/home/caminhao/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npx ng test --watch=false --browsers=ChromeHeadlessCI
npm run build
```

Tudo verde antes de commitar. No máximo 2 processos pesados ao mesmo tempo (a máquina já reiniciou por falta de memória). Nunca `pkill -f`. Não use Docker nem suba backend.

Commits pequenos, com caminhos explícitos (nunca `git add -A`, nunca amend/reset; `index.lock` = esperar e repetir), prefixo convencional em português (`feat(web): ...`, `test(web): ...`), terminando com `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Não faça push. Dúvida ou mudança de contrato: escreva em `.superpowers/sdd/whatsapp-item-5/duvidas.md` e pare, não invente.

Ao terminar, escreva `.superpowers/sdd/whatsapp-item-5/resultado-5b.md` (arquivos, comandos e números verdes, o que NÃO verificou) e responda com resumo curto.
