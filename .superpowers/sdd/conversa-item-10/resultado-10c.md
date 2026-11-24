# Item 10c — Fechamento do Telegram (integração real no navegador) — resultado

Ramo: fechamento direto na `develop` (sem código de produto novo).

## O que foi feito

Integração real **no Chrome de verdade** (puppeteer-core + Chrome do cache do puppeteer), com o app servido por `ng serve` (:4200), backend real (:3000), Postgres 18 e Redis 7 descartáveis (5546/6392, datadir apagado no fim) e **Bot API falsa local** (:3399) — o backend foi apontado para ela via `TELEGRAM_BASE_URL` (D8). Roteiro: `/tmp/opencode/integracao-10c.mjs`.

## Checagens (11, duas corridas, 0 falhas)

1. Conta A logada pela UI vê o cartão Telegram em "sem vínculo" com o consentimento certo (D7: "servidores da Telegram" e o "confirme no app" da escrita desligada, D3).
2. "Gerar código de vínculo" mostra o código em `XXXX-XXXX`, o prazo e o **@lumen_test_bot** vindo do `getMe` do status.
3. Código de 8 caracteres do alfabeto certo lido do DOM.
4. O "chat" manda o código na Bot API falsa → o backend faz o pareamento → o **app detecta pelo próprio polling** e vira para "Telegram vinculado:".
5. Chat mascarado `98••••••10` na tela, sem o id inteiro em lugar nenhum (D1/D7).
6. O bot respondeu "Pronto! Este chat está vinculado…" no chat (visto pela API falsa, com `parse_mode: HTML`).
7. "Desvincular" pede confirmação em duas etapas (Confirmar/Cancelar).
8. "Confirmar desvínculo" volta o cartão para "Nenhum Telegram vinculado".
9. Chat desconhecido recebe **uma** orientação do bot ("gere um código de vínculo…").
10. Segunda conta B pela mesma UI não vê o vínculo de A.
11. B gera o próprio código com o mesmo @ do bot.

## Notas de execução

- Dois insucessos da primeira rodada eram do **roteiro de teste**, não do produto: (a) o seletor de texto "Telegram vinculado" casava como substring com "Nenhum **Telegram vinculado**" (falso positivo lido cedo demais) e (b) a leitura do envio acontecia antes de o bot responder. Corrigidos com espera pelo prefixo com dois-pontos e espera com prazo.
- A troca de conta no navegador precisou limpar o **IndexedDB** (Preferences do Capacitor), não só `localStorage` — comportamento esperado do app, o roteiro é que estava errado.
- Console do navegador: sem erros relevantes nas corridas.
- Ambiente: os binários do /tmp tinham sido coletados; re-extraídos com `apt-get download + dpkg -x` (Postgres 18.6 + Redis 7 + libs) e recriado com `/tmp/opencode/subir-10.sh`, derrubado no fim (portas 5546/6392/3000/4200/3399 livres).

## NÃO verificado (aceito)

- Bot real criado no @BotFather contra `api.telegram.org` (exige token do dono; o contrato já registrava que a validação com o bot real é ação do dono).
- Teclado nativo do Telegram renderizado num celular real (o formato enviado foi conferido no JSON da API falsa).
- Safari/iOS e leitor de tela real (mesmas ressalvas do 5b/8d).
