# Resultado 5b: cartão WhatsApp em Configurações

Branch: feat/whatsapp-adapter. Escopo: só frontend/. Sem push. Backend não tocado.

## Commits

- 490789c feat(web): service e modelos do vínculo de WhatsApp
  - frontend/src/app/core/models/whatsapp.models.ts
  - frontend/src/app/core/services/whatsapp-api.service.ts
  - frontend/src/app/core/services/whatsapp-api.service.spec.ts
- 58d7378 feat(web): cartão WhatsApp na aba Conta de Configurações
  - frontend/src/app/features/settings/whatsapp-card/whatsapp-card.component.{ts,html,scss,spec.ts}
  - frontend/src/app/features/settings/settings-page/settings-page.component.{ts,html}

## Decisões

- Cartão fica antes da "Zona de perigo" na aba Conta (o brief diz "no fim da aba"; mantive a zona de perigo por último).
- Cartão tem superfície própria no scss. Classes de `settings-action-card` do scss da página não atravessam o encapsulamento do componente.
- Telefone formatado no front: `+5511912345678` vira `+55 11 91234-5678`. Formato não reconhecido sai cru.
- Erro 503 em qualquer ação vira estado "desligado". 409 ao gerar recarrega o status. 429 mostra o texto de limite sem botão de tentar de novo. Demais erros mostram texto fixo e "Tentar de novo" que refaz a ação.
- Polling a cada 5 s só existe com código visível. Contagem de 1 s para expirar no tempo certo.

## Comandos e números

- `npx tsc --noEmit -p tsconfig.app.json`: limpo.
- `ng test --watch=false --browsers=ChromeHeadlessCI`: 334 de 334 SUCCESS (inclui os specs novos; não conferi contagem por arquivo).
- `npm run build`: EXIT 0. Só o NOTE de target ES2022 já existente.

## Não verificado

- Visual real: claro e escuro, 360 px sem rolagem horizontal, desktop. Não rodei o app nem capturei tela.
- Clipboard real no Chrome. Os testes usam mock de `navigator.clipboard`.
- Contraste e foco visível em tema escuro.
- Integração com backend real (5c).
- Formato real de `contactNumber` vindo do servidor: o formatador assume `55` + DDD + número. Se vier outro formato, sai cru.
- Nenhum `console.log`, `any` ou dependência nova (verificado por leitura, não por lint; lint não foi rodado).
