# Confirmar e-mail das contas que já existiam

As contas criadas antes do fluxo de confirmação (v1.41.0) têm `emailVerifiedAt` vazio: veem o banner
"Confirme seu e-mail" e **não recebem** lembretes, resumo semanal nem alertas por e-mail. Este runbook
manda o e-mail de confirmação para todas de uma vez.

É uma rotina de linha de comando (`backend/src/scripts/send-verification-emails.ts`), não uma rota:
não existe endpoint que dispare e-mail em massa.

## Antes de rodar (na VPS)

- Deploy da v1.44.1 (ou mais nova) feito, com front e back atualizados.
- `.env.production` com `RESEND_ENABLED=true`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
  `FRONTEND_URL=https://financelumen.tech` e `AUTH_EMAIL_LINK_SECRET`.

A rotina **recusa enviar** se o Resend estiver desligado ou se `FRONTEND_URL` apontar para `localhost`
(o link do e-mail ficaria quebrado).

## Passo a passo

Rode dentro da pasta do projeto na VPS. `docker compose -f docker-compose.prod.yml exec backend` executa
no container que já está no ar.

1. **Ensaio** (não envia nada; lista quem receberia, com o e-mail mascarado):

   ```bash
   docker compose -f docker-compose.prod.yml exec backend \
     node dist/scripts/send-verification-emails.js
   ```

2. **Teste em uma caixa só** (a sua). Confira que o e-mail chegou, não caiu em spam e o botão confirma:

   ```bash
   docker compose -f docker-compose.prod.yml exec backend \
     node dist/scripts/send-verification-emails.js --send --email=seu@email.com
   ```

3. **Envio para todas** (pausa de 700 ms entre e-mails para respeitar o limite do Resend):

   ```bash
   docker compose -f docker-compose.prod.yml exec backend \
     node dist/scripts/send-verification-emails.js --send
   ```

## O que a rotina faz e não faz

- Só considera contas com e-mail **não confirmado**.
- **Pula** quem já tem um link válido na caixa (por exemplo, quem acabou de se cadastrar). Reenviar
  invalidaria o link anterior. Use `--force` só se quiser reenviar mesmo assim.
- É **segura para repetir**: se um envio falhar, o link criado é removido e a próxima rodada tenta de
  novo só essa conta. Termina com código de saída `2` quando houve falha.
- O link vale **48 horas**. Quem não clicar continua com o banner e pode usar "Reenviar" no app; rodar a
  rotina de novo depois disso reenvia para quem ficou com o link vencido.
- O relatório nunca imprime o e-mail inteiro (`m*****@gmail.com`).

Opções: `--limit=N`, `--delay-ms=N`, `--force`, `--allow-localhost` (só para teste local).

## Depois

Quem confirmar passa a receber lembretes, resumo semanal e alertas críticos por e-mail, cada um com o
link de descadastro. Acompanhe no painel do Resend a taxa de entrega e de spam antes de considerar
concluído.
