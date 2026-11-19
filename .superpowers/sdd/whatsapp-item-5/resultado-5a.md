# Resultado 5a: backend do adaptador WhatsApp

Branch: `feat/whatsapp-adapter`. Commits novos (sem push):

- `d25bcb1` feat(whatsapp): modelos WhatsappLink e WhatsappLinkCode com migration
- `65ecafc` feat(whatsapp): config, vinculo por codigo, assinatura do webhook e formatacao
- `3346552` feat(whatsapp): webhook assinado, adaptador, cliente WA-AKG e limites
- `8c0c608` feat(whatsapp): trava de escrita do WhatsApp no motor de conversa

## Arquivos

Novos em `backend/src/whatsapp/`: `whatsapp.config.ts`, `webhook-signature.ts`, `whatsapp-mask.ts`, `whatsapp-format.ts`, `whatsapp-link.service.ts`, `wa-akg.client.ts`, `whatsapp-adapter.service.ts`, `whatsapp.controller.ts`, `whatsapp.module.ts`, e os `*.spec.ts` ao lado de cada um (sem `dto/`, que nao foi necessario).

Alterados: `backend/prisma/schema.prisma` (2 modelos e 2 relacoes em `User`), `backend/prisma/migrations/20261118120000_whatsapp_link/migration.sql` (nova), `backend/src/app.module.ts` (config e modulo), `backend/src/main.ts` (rawBody so na rota do webhook), `backend/src/common/guards/rate-limit.guard.ts` e `.spec.ts` (2 politicas), `backend/src/conversation/conversation.service.ts` e `.spec.ts` (trava de escrita, `ConfigService` injetado), `backend/src/conversation/replies.ts` (`whatsappWritesOff`), `.env.example` (so nomes das variaveis).

## Numeros reais

- `npx tsc --noEmit`: 0 erros.
- `npx nest build`: ok.
- `npx jest --maxWorkers=2` (suite inteira): 59 suites, 1514 testes, todos passando.
- `TZ=UTC`, `TZ=America/Sao_Paulo`, `TZ=Asia/Tokyo` com `npx jest src/conversation src/whatsapp --maxWorkers=2`, um de cada vez: 15 suites, 574 testes, verde nas tres.
- Migration: conferida contra Postgres 16 descartavel (container temporario, removido). `migrate diff` contra o schema: "This is an empty migration".

## Nao verificado

- Lint: nao rodei.
- Mutantes da secao 9: nao rodei (tarefa do revisor sonnet).
- Fluxo HTTP real: nao subi o backend contra Postgres/Redis; a rota de webhook e o `verify` do `json()` no `main.ts` so tem teste unitario ou leitura de codigo, nao teste de integracao.
- Nada foi enviado ao WA-AKG real. Nenhum servidor da VPS foi tocado. `wa-akg` nao foi alterado.
- `prisma migrate dev/deploy` nao foram rodados (so `prisma generate`).

## Duvidas

Ver `.superpowers/sdd/whatsapp-item-5/duvidas.md` (8 itens; o principal e o endereco do app na resposta de midia, que nao existe fixo no codigo).

Arquivos `.superpowers/sdd/whatsapp-item-5/resultado-5a.md` e `duvidas.md` nao foram commitados.
