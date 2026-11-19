# Resultado da revisão e correção do 5b (cartão WhatsApp no front)

Branch: feat/whatsapp-adapter. Revisor: sonnet. Escopo: só `frontend/`. Sem push. Backend não tocado.
Diff revisado: `0d44a3f..HEAD` (commits 490789c e 58d7378 do dev).

## Achados e o que mudou

### Alta

1. **Consentimento incompleto.** O contrato (spec do item 5, seção 6) exige que o cartão diga, antes de gerar o código, que o canal usa WhatsApp não oficial. O texto do brief do dev dizia só "canal de terceiros". Corrigido: "O Lumen usa uma conexão não oficial com o WhatsApp, um canal de terceiros: o texto das suas mensagens passa por ele." Teste novo cobre "não oficial". Decisão do dono a confirmar: se prefere outra redação (o brief do 5b e a spec divergiam).
2. **Código de vínculo quebrava em duas linhas em 360 px** ("K7M2-" / "QX9P"). Visto na captura. Corrigido: `font-size: clamp(1.4rem, 8vw, 2rem)`, `white-space: nowrap`. Medido: 28,8 px em 360 px, uma linha só.

### Média

3. **Foco se perdia** (caía no body) ao clicar Desvincular, Cancelar, Gerar código e ao desvincular com sucesso, porque o botão clicado saía do DOM. Corrigido com `afterNextRender` + `data-focus`: Desvincular leva ao "Confirmar desvínculo"; Cancelar volta ao "Desvincular"; gerar leva ao código (que tem `tabindex="-1"` e o `aria-label` soletrado); desvincular com sucesso leva ao "Gerar código". Teste novo.
4. **Resposta atrasada de `link-code`** podia mostrar código e ligar polling com o cartão já fora de "não vinculado". Corrigido: se `state() !== "unlinked"` a resposta é descartada. Teste novo.
5. **Polling com `switchMap`**: requisição lenta (>5 s) era cancelada a cada ciclo e nunca entregava. Trocado por `exhaustMap` (sem requisição concorrente, sem fome). Teste novo.
6. **503 no polling** era engolido pelo `catchError(() => EMPTY)` e o polling seguia até o prazo. Agora 503 vai para "desligado" e para os timers; `enabled=false` no polling também. Outros erros seguem ignorados até o próximo ciclo (o prazo de 10 min limita). Teste novo.
7. **Contagem regressiva dentro do `aria-live="polite"`** anunciaria "faltam N min" a cada minuto. Linha com `aria-live="off"`.

### Baixa

8. `formatPhone`: texto com letras ou lixo (ex. "abc5511912345678") era reduzido aos dígitos e formatado, descartando caracteres. Agora só formata se for só dígitos, espaço, `+`, parênteses e hífen; senão sai cru. `contactNumber` só com espaços vira "o número do Lumen" (`trim`). Testes novos (10 casos).
9. Caixa do código aninhada (borda e fundo dentro do cartão) trocada por barra lateral de acento: menos "card dentro de card", sem cor fixa.

### Conferido sem achado

- Contrato: URLs, métodos, 409, 429, 503, erro genérico sem corpo bruto. Código não vai a storage/URL/log/toast/erro; `console.*` e `any` ausentes; sem dependência nova; `settings-page` só ganhou import e `<app-whatsapp-card />`. Variáveis do tema usadas (`--surface-panel*`, `--text-*`, `--danger`, `--accent`), sem cor fixa. Unlink com erro mantém "vinculado" (comportamento certo; faltava teste).
- Clipboard ausente/rejeitado: já tratado (teste de ausência novo).
- Cartão fica antes da "Zona de perigo" (decisão do dev, mantida).

## Mutantes (spec focado, original do dev)

| | Mutante | Resultado |
|---|---|---|
| a | sem cancelar timers no destroy | morreu |
| b | polling não para ao ver linked | morreu (por exceção no 3o `getStatus`, teste frágil mas falha) |
| c | código não limpo ao vincular | **sobreviveu** -> teste novo "o código sai do estado do componente" (polling, expiração e destroy); agora morre |
| d | unlink marca "não vinculado" com erro | **sobreviveu** -> teste novo "falha ao desvincular mantém vinculado e oferece Tentar de novo"; agora morre |
| e | sem tratamento do 409 | morreu |
| f | sem tratamento do 429 | morreu |
| g | botão "Gerar código" no estado vinculado | **sobreviveu** -> teste novo "no estado vinculado não há botão de gerar código"; agora morre |
| h | sem desabilitar botão durante a chamada | morreu |
| i | código não expira | morreu |

Mutantes extras nas correções (todos morrem): `exhaustMap` -> `switchMap`; sem guarda de resposta atrasada; sem foco após desvincular. Cada mutante foi revertido (`git checkout` do arquivo, `git diff` limpo antes de seguir).

## Capturas vistas (Chrome do Playwright, build real servido estático, servidor falso em node)

Estados: carregando, desligado, não vinculado, código gerado, código expirado, vinculado, confirmando desvínculo, erro. Tamanhos: 360x740 e 1280x900, claro e escuro. Total 32 capturas, todas medidas por script:
- Sem rolagem horizontal em nenhuma (`scrollWidth` do documento <= janela).
- Todos os botões 44 px de altura (>= 44).
- Código em uma linha: 28,8 px (360) e 32 px (desktop).
- Texto legível e erro em vermelho do tema nos dois temas; estados não dependem só de cor (texto muda).
- Salto de layout: carregando (96 px) vira 434 px em 360 px quando abre o estado "não vinculado" (cresce para baixo, só empurra a Zona de perigo). Não corrigi: o conteúdo é novo, não troca de lugar.

## Números

- `npx tsc --noEmit -p tsconfig.app.json`: limpo.
- `ng test` completo: 349 de 349 SUCCESS (334 antes; 15 testes novos: 13 no cartão e 2 de formatPhone).
- `npm run build`: ok (só o NOTE de target ES2022 já existente).
- Lint: o `package.json` do front não tem script `lint`; não rodado.

## NÃO verificado

- Backend real (fica para o 5c); o servidor falso devolve os formatos do contrato, não prova o formato real de `contactNumber`.
- Leitor de tela de verdade (NVDA/VoiceOver): `aria-live`, `aria-label` do código e foco foram conferidos por teste e leitura, não ouvidos. `aria-live="off"` aninhado em região `polite` depende do leitor.
- Clipboard real: só mock nos testes; na captura não cliquei Copiar.
- Contraste medido só a olho nas capturas, sem calculadora WCAG.
- Tema escuro no desktop: capturado, olhei por amostra (4, 6; mobile escuro visto em 4, 5, 7, 8).
- Dispositivo móvel real / teclado virtual.
- Falhas de rede intermitentes no polling (só 503 tratado; outros erros ignorados até o próximo ciclo).
