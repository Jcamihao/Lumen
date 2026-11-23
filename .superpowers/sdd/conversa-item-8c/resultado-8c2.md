# Resultado 8c-2 — frontend do editar/apagar contas fixas e parcelados (item 8c, parte final)

Feito pelo Qwen na própria sessão. Contrato: `docs/superpowers/specs/2026-11-23-conversa-contrato-item-8c.md`.

## O que entrou (pequeno, como previsto no contrato)

- `conversation.models.ts`: `DraftKind` ganha `RECURRING_CHANGE | INSTALLMENT_CHANGE`.
- `assistant-page.component.ts` + `.html`: `pendingFieldLabel(field, kind)` — o mesmo `targetChoice` agora diz **"conta fixa ou parcelado"** nos kinds da 8c e segue **"meta ou reserva"** nos da 8b (era o único ponto do app que precisava saber o kind; o resto do cartão já vinha guiado por `changeAction` do 8a-2).
- Karma: 4 testes (apagar conta fixa com flag, apagar parcelado com o aviso, rótulo do RESTORED por kind, restaurado sem o atalho "apagar").

## Verificação (2026-11-23, worktree Lumen-item8a2)

- Karma assistant-page **81/81** (77 da 8b-2 + 4), karma inteira **374 verdes**; `tsc` app/spec limpos; `ng build` ok.
- Backend não foi tocado aqui (a 8c-1 já estava na develop).

## NÃO verificado

- Clique real no navegador contra o backend (mesmo aceite da 8b-2: a integração HTTP da 8c-1 cobriu o contrato; o cartão é o mesmo código do 8a-2).
