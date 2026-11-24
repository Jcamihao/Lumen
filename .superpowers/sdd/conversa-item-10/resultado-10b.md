# Item 10b — Cartão "Telegram" no app — resultado

Ramo: `feat/telegram-10b` (da develop pós-10a). Espelha o cartão do WhatsApp do 5b, com as adaptações do contrato 10 (D1/D3/D7).

## O que entrou

- `core/models/telegram.models.ts` — `TelegramStatus` (`enabled`, `linked`, `linkedAt?`, `maskedChatId?`, `botUsername?`) e `TelegramLinkCode`, sincronizados com o controller da 10a.
- `core/services/telegram-api.service.ts` — `GET /telegram/status`, `POST /telegram/link-code`, `DELETE /telegram/link`; nada persistido no navegador (o código nunca vai para storage).
- `features/settings/telegram-card/` — componente novo com os mesmos estados do cartão do WhatsApp (carregando/desligado/erro/sem vínculo/vinculado), código com prazo e contagem, copiar, expiração, polling de status que detecta o vínculo e toca o toast, desvincular em duas etapas, foco gerenciado e código soletrado para leitor de tela. Diferenças para o WhatsApp: a instrução manda abrir a conversa com **@bot** (label vem de `botUsername`, com fallback "o bot do Lumen no Telegram"); o vinculado mostra o **chat mascarado** (`98••••••10`, nunca o id inteiro); o consentimento (D7) diz que o texto das mensagens passa **pelos servidores da Telegram, a empresa do canal** e mantém "confirme no app" enquanto a escrita do canal está desligada por padrão (D3).
- `settings-page` importa o cartão e o renderiza logo abaixo do `<app-whatsapp-card />` na seção da conta.

## Verificação

- karma do cartão: **31/31** verdes de primeira.
- karma inteira: **411/411** (eram 380).
- `ng build` de produção ok.
- Caçada a mutantes nos trechos próprios da 10b (classe "copia-e-cola" do WhatsApp): 4 mutantes — `@` fora do label do bot, fallback do label vazio, toast do polling dizendo "WhatsApp", toast do desvínculo dizendo "WhatsApp" — **4/4 mortos**. O resto da lógica é espelho byte a byte do cartão do WhatsApp, já caçado a mutantes no 5b.
- Ambiente: o `chromelibs` do /tmp tinha sumido (limpeza do sistema); re-extraído com `apt-get download libnspr4/libnss3/libasound2t64 + dpkg -x` (mesma técnica dos binários do Postgres).

## NÃO verificado (aceito)

- Integração real no navegador (fica na 10c).
- Visual em Safari/iOS e leitor de tela real (mesmas ressalvas aceitas no 5b).
