# Brief de revisão e correção do 5b (cartão WhatsApp no front), subagente sonnet

Você lê o diff inteiro, roda tsc, testes e build, confere o visual de verdade, **corrige** o que achar e relata. Relate em caveman terse (português); código, comentários, commits e documentos em prosa normal.

## Contexto

- Repositório `/home/caminhao/coding/codeStage/Lumen`, branch `feat/whatsapp-adapter` (confira com `git branch --show-current`; outra = pare e avise). Commits do dev (haiku) a revisar: `490789c` e `58d7378` (`git diff 0d44a3f..HEAD`). Só `frontend/` mudou. O backend (5a) já está revisado: não mexa nele.
- Leia primeiro: `docs/superpowers/specs/2026-11-18-conversa-contrato-item-5.md` (seções 5, 6 e 11), `.superpowers/sdd/whatsapp-item-5/brief-5b-frontend.md` (o que o dev recebeu) e `resultado-5b.md` (relato do dev, incluindo o que ele NÃO verificou).
- Use `graphify query` antes de varrer arquivos.

## O que conferir (leia o código, não aceite o relato)

1. **Contrato**: URLs, métodos, tipos e tratamento de 409, 429, 503 e erro genérico conforme o brief. O erro nunca mostra corpo bruto.
2. **Código de vínculo é segredo de curta duração**: não vai a `localStorage`/`sessionStorage`, URL, log, toast, nem a mensagem de erro; é limpo do estado ao vincular, ao expirar, ao desvincular e no destroy. `console.*` ausente.
3. **Timers**: polling de 5 s só com código visível; para em vincular, expirar, destroy e erro persistente; sem polling empilhado (gerar novo código com timer antigo vivo); sem requisição concorrente se a anterior não voltou. Contagem regressiva não acumula `setInterval`.
4. **Corridas de estado**: resposta de `link-code` chegando depois de o usuário desvincular ou de o status já ser `linked`; duplo clique; `unlink` falhando (o cartão não pode mostrar "não vinculado" se o 204 não veio).
5. **Formatação do telefone**: `contactNumber` com formatos estranhos, vazio, `undefined`, com `+`, sem DDI. Nunca inventar dígitos; formato desconhecido sai cru.
6. **Cópia**: `navigator.clipboard` ausente (http, iOS antigo) e rejeitado; o botão não quebra e avisa.
7. **A11y**: `aria-live`, `aria-label` do código soletrado, foco visível, alvos ≥ 44 px, confirmação do desvínculo move/mantém foco de forma previsível, estados sem depender só de cor.
8. **Texto**: acentuação, tom do Lumen (direto, sem exclamação, sem gíria), consentimento visível ANTES do botão e completo.
9. **Qualidade**: sem `any`, sem código morto, sem dependência nova, OnPush e signals corretos, sem estado duplicado, scss usando as variáveis do tema do projeto (nenhuma cor fixa que quebre claro ou escuro), `settings-page` só ganhou o import e o `<app-whatsapp-card />`.
10. **Testes do dev**: leia os specs e procure teste que passa sem provar nada (asserção fraca, mock que sempre responde igual). Veja se cobrem de fato cada item do brief.

## Mutantes (aplique um por vez com a ferramenta de edição, rode o spec focado, confirme que **algum teste falha**, reverta e confirme com `git diff`)

(a) retirar o `clearInterval`/cancelamento do polling no destroy. (b) polling não parar ao ver `linked=true`. (c) código não ser limpo ao vincular. (d) `unlink` marcar não vinculado mesmo com erro. (e) retirar o tratamento do 409. (f) retirar o tratamento do 429. (g) mostrar o botão "Gerar código" também no estado vinculado. (h) retirar o desabilitar do botão durante a chamada. (i) não expirar o código quando o prazo passa. Sobreviveu = escreva o teste que o mata e relate.

## Visual real (obrigatório)

O dev não viu o cartão renderizado. Faça isto num diretório do scratchpad (nunca no projeto):
- `npm run build` no `frontend`, servir `frontend/dist/frontend` com um servidor estático e um `assets/app-config.js` apontando `apiBaseUrl`/`wsBaseUrl` para um **servidor falso seu** (node http, poucas linhas) que implementa `POST /auth/...` mínimo para logar, os endpoints que a página de Configurações chama ao abrir, e `GET /whatsapp/status`, `POST /whatsapp/link-code`, `DELETE /whatsapp/link` por cenário. Se logar for trabalhoso, injete a sessão do jeito que o projeto guarda (veja `AuthService`).
- Chrome do Playwright em `/home/caminhao/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`. Capture (e **olhe** as imagens) os estados: carregando, desligado, não vinculado, código gerado, código expirado, vinculado, confirmando desvínculo, erro; em **360 px e desktop, claro e escuro**. Confira: sem rolagem horizontal, texto não cortado, contraste legível, código grande legível, botões ≥ 44 px, sem salto de layout ao trocar estado.
- Não use o `.env` real nem copie chaves reais. Sem Docker (o backend real fica para o 5c).
- Máximo 2 processos pesados ao mesmo tempo. Nunca `pkill -f` (mate por PID de `ss -ltnp`). Ao terminar, derrube servidores e apague o que criou no scratchpad.

## Como rodar e entregar

```
cd frontend
npx tsc --noEmit -p tsconfig.app.json
PUPPETEER_EXECUTABLE_PATH=/home/caminhao/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome CHROME_BIN=/home/caminhao/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npx ng test --watch=false --browsers=ChromeHeadlessCI
npm run build
```

Tudo verde antes de commitar. Commits pequenos, caminhos explícitos (nunca `git add -A`, nunca amend/reset; `index.lock` = esperar e repetir), prefixo convencional em português, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Não faça push. Lint do front: rode se existir script `lint`; senão diga.

Escreva `.superpowers/sdd/whatsapp-item-5/resultado-rev-5b.md`: achados por severidade com o que mudou, mutantes (quais morreram, quais sobreviveram e o teste novo), capturas vistas (lista de estados e tamanhos), números verdes, o que NÃO verificou. Responda com resumo curto.
