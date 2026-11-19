# Brief de revisão e correção do 5a (backend do adaptador de WhatsApp), subagente sonnet

Revisão **obrigatória de segurança** (identidade, assinatura, vínculo de conta, trava de escrita). Você lê o diff inteiro, roda build, testes e **mutantes**, prova o comportamento real com Postgres e Redis descartáveis, **corrige** o que achar e relata. Relate em caveman terse (português); código, comentários, commits e documentos em prosa normal.

## Contexto

- Repositório `/home/caminhao/coding/codeStage/Lumen`, branch `feat/whatsapp-adapter` (confira com `git branch --show-current`; outra = pare e avise). Commits do dev (haiku) a revisar: `d25bcb1`, `65ecafc`, `3346552`, `8c0c608` (`git diff 90a00cb..HEAD`).
- Leia primeiro: `docs/superpowers/specs/2026-11-18-conversa-contrato-item-5.md` (contrato aprovado), `.superpowers/sdd/whatsapp-item-5/brief-5a-backend.md` (o que o dev recebeu), `.superpowers/sdd/whatsapp-item-5/resultado-5a.md` e `duvidas.md` (relato e dúvidas do dev). Contrato do WA-AKG (terceiros, **não toque** em `/home/caminhao/coding/codeStage/wa-akg`): resumido no brief do dev.
- Código novo em `backend/src/whatsapp/`; alterações em `schema.prisma`, migration `20261118120000_whatsapp_link`, `app.module.ts`, `main.ts` (corpo bruto), `rate-limit.guard.ts`, `conversation.service.ts` (trava `whatsapp.writesEnabled`) e `replies.ts`.
- Use `graphify query` antes de varrer arquivos.

## O que conferir (leia o código, não aceite o relato do dev)

1. **Assinatura e corpo bruto.** `verifyWebhookSignature` sobre os bytes originais. O `verify` do `json()` em `main.ts` guarda `rawBody` só para `/api/v1/whatsapp/webhook`: prove com o backend real que (a) a rota recebe o corpo bruto, (b) as outras rotas não ganham `rawBody` nem mudam de comportamento, (c) o prefixo global real bate com o `startsWith` (`app.setGlobalPrefix`?), (d) um corpo com espaços e ordem de chaves diferentes valida pelo byte original, não pelo JSON reserializado.
2. **Webhook sem autenticação.** A rota é `@Public()`: confirme que `JwtAuthGuard`, `RolesGuard` e `RateLimitGuard` se comportam (a política `POST /api/v1/whatsapp/webhook` realmente casa com a rota real; a de `link-code` também). Sem assinatura nada é processado, inclusive com `WHATSAPP_ENABLED=true` e segredo vazio (o boot deve recusar, mas teste também o controller).
3. **Identidade.** `userId` só do `WhatsappLink` (`jid` → `userId`). Procure qualquer caminho em que texto, `pushName`, `key.id`, `participant` ou campos extras de `data` influenciem o dono. `data.from` vs `data.key.remoteJid`: o código usa `from`; avalie se há divergência explorável (um corpo assinado só vem do WA-AKG, mas pense no que um número hostil pode mandar para o WhatsApp do Lumen, por exemplo mensagens encaminhadas ou citadas).
4. **Vínculo.** Fluxo completo: gerar código (só o hash no banco), resgatar certo, errado, expirado, usado, de outro formato; dois resgates simultâneos do mesmo código; mesmo `jid` em duas contas; mesma conta com dois `jid`; código consumido mesmo quando o vínculo é recusado; gerar código novo apaga os anteriores; desvincular apaga vínculo e sessão `WHATSAPP`, preserva a `APP`. A transação de `createCode` (`$transaction([deleteMany, create])`) e a corrida entre `createCode` e `redeem`.
5. **Limites no Redis real.** A contagem de falhas de código usa `cache.getJson<number>(failKey)` para ler um contador criado por `hitRateLimitWindow` (que faz `INCR`). Prove com Redis real que a leitura devolve o número certo (se `getJson` falha ou devolve `null` com valor `"3"`, o bloqueio de 5 falhas **nunca dispara**: isso seria bug de segurança, corrija e teste com Redis real). Prove também os 20/minuto, a orientação 1/hora e o comportamento sem Redis (`hitRateLimitWindow` devolve `null`).
6. **Trava de escrita.** `WHATSAPP` + `writesEnabled` falso + "confirmar" em `AWAITING_CONFIRMATION`: nada grava. Procure **outros caminhos de escrita pelo canal WhatsApp** que não passem por esse ramo (por exemplo, "sim", "ok", "confirmar" com variações de caixa e acento, mensagens que o motor interpreta como confirmação em outro estado, `handleWithoutSession` criando algo direto sem rascunho). Toda gravação por WhatsApp precisa passar pela trava enquanto `writesEnabled` for falso.
7. **Privacidade de logs e erros.** Nenhum log com texto de mensagem, código de vínculo, chave de API, segredo ou `jid` inteiro (só `maskJid`). Rode o backend real e procure nos logs. Mensagens de erro do cliente WA-AKG (`error.message`) podem conter a URL ou o corpo? Verifique o que o `WaAkgClient` coloca nelas.
8. **Cliente WA-AKG.** URL, `encodeURIComponent` do `jid`, cabeçalhos, timeout, sem redirecionamento seguido para outro host (`redirect: 'manual'` ou equivalente: avalie SSRF/vazamento da chave se `WA_AKG_BASE_URL` redirecionar), resposta não-2xx tratada.
9. **Schema e migration.** `WhatsappLinkCode.failedAttempts` existe e não é usado (o dev avisou). **Remova a coluna** do schema e da migration (ainda não foi para nenhum ambiente; edite a migration original) e do que a referencia. Confira a migration contra o schema (`prisma migrate diff`) e em banco limpo e sobre as 27 migrations anteriores.
10. **Qualidade.** Comentários em português só onde o motivo não é óbvio; sem código morto; `process()` e os textos fixos coerentes com o contrato; nada que quebre os outros módulos (`ConversationService` agora recebe `ConfigService`: todos os pontos que o constroem estão atualizados e a suíte do motor passa nas três zonas).

## Mutantes obrigatórios (aplique um por vez com a ferramenta de edição, rode o teste focado, confirme que **algum teste falha**, reverta com a ferramenta de edição e confirme o arquivo restaurado com `git diff`)

(a) `verifyWebhookSignature` sempre `true`. (b) comparação de assinatura trocada por `===` de strings. (c) controller sem checar `rawBody`/assinatura. (d) `findUserIdByJid` devolvendo qualquer vínculo (por exemplo sem o `where jid`). (e) retirar o `usedAt: null` do `findFirst` ou do `updateMany` em `redeem`. (f) retirar o `expiresAt > now`. (g) retirar a checagem de `jidTaken`/`userLinked` e o tratamento de P2002. (h) `createCode` sem apagar os códigos anteriores. (i) `unlinkByUserId` apagando também a sessão `APP` (remover o filtro de canal). (j) retirar a trava `writesEnabled` no motor. (k) trocar `reply.kind === 'DUPLICATE'` para não suprimir o envio. (l) retirar o descarte de `fromMe`, de grupo e de `sessionId` diferente (um por vez). (m) retirar o limite de 20/minuto e o de 5 falhas. (n) fazer o adaptador chamar o motor para número sem vínculo. (o) retirar o `maskJid` do log de envio. Mutante que sobreviver = escreva o teste que o mata, rode de novo e relate.

## Integração real (obrigatória)

Docker já está ligado nesta máquina. **Não toque** em `agilis-postgres` (5432), `agilis-redis` (6379), `habblaud` nem nos containers de desenvolvimento do Lumen. Crie só `lumen-w5-pg` (Postgres 16, porta 55434) e `lumen-w5-redis` (Redis 7, porta 56381), banco novo, `prisma migrate deploy` (todas as migrations). Backend de teste em `node dist/main` na porta **3391**, com um arquivo de ambiente **próprio** em pasta do scratchpad (cópia mínima: nunca copie o `.env` da raiz com chaves reais; crie as variáveis necessárias com segredos de teste inventados) e `WHATSAPP_ENABLED=true`, `WHATSAPP_WRITES_ENABLED=false` primeiro, depois `true`. O `ConfigModule` lê `../../.env` relativo ao `dist`; monte a estrutura como o revisor da 4 fez (cópia de `backend/dist` em uma pasta do scratchpad com `.env` dois níveis acima, `node_modules` por link) para o backend não ler o `.env` da raiz.

**WA-AKG falso:** um servidor HTTP pequeno seu (Node, no scratchpad, não no repositório; pode ficar de apoio para a 5c: deixe o script em `.superpowers/sdd/whatsapp-item-5/fake-wa-akg.mjs` e documente o uso no topo) que (1) recebe `POST /api/messages/{sessionId}/{jid}/send`, confere `X-API-Key` e guarda o que chegou, e (2) tem uma função/endpoint de apoio que **assina** e envia um webhook `message.received` para o Lumen com HMAC-SHA256 do corpo bruto, como o WA-AKG real. Defina `WA_AKG_BASE_URL` apontando para ele.

Cenários, com o backend real:
1. Duas contas A e B (cadastre pela API com o consentimento de privacidade, como a integração anterior). A gera código, envia do número `5511999990001@s.whatsapp.net`, vincula; B vincula `5511999990002@s.whatsapp.net`. Cada uma lança "50 mercado" e "saldo": respostas separadas, dados separados (confira no banco que a transação e a sessão ficam no `userId` certo e no canal `WHATSAPP`).
2. Com `WHATSAPP_WRITES_ENABLED=false`: "50 mercado" monta rascunho, "confirmar" não grava e responde a mensagem de "confirme no app"; o botão do app (`POST /conversation/confirm`) grava. Com `true`: "confirmar" grava.
3. Reentrega: o mesmo `key.id` duas vezes, nenhuma segunda resposta enviada e uma só transação.
4. Assinatura: ausente, inválida, corpo alterado em 1 byte, válida: 401/401/401/200; o falso confirma que nada foi enviado nos 401.
5. Número desconhecido: orientação uma vez; segunda mensagem em seguida sem resposta; código errado repetido 6 vezes: a 6ª tentativa não chega ao `redeem` e não há resposta (prove com contador/log de teste ou no banco).
6. 21 mensagens em um minuto: a 21ª sem resposta.
7. Mídia, `desvincular whatsapp`, texto de 1001 caracteres, grupo, `fromMe`, `sessionId` errado.
8. Dois resgates simultâneos do mesmo código vindos de dois números: só um vincula.
9. WA-AKG falso fora do ar ou lento (responder 500 e depois não responder): o webhook ainda devolve 200 e o backend não cai nem registra texto.
10. Logs do backend: procure texto de mensagem, código de vínculo, chave de API e `jid` inteiro. Nada deve aparecer.
11. As outras rotas (por exemplo `POST /conversation/message`) continuam funcionando com o `json()` modificado.
12. `WHATSAPP_ENABLED=true` com variável faltando: o backend **não sobe** e a mensagem lista só nomes.

No fim, **derrube tudo**: containers `lumen-w5-*` (`docker rm -f`), o backend e o falso (mate por **PID** obtido de `ss -ltnp`; **nunca** `pkill -f` com padrão amplo: isso já matou o shell do revisor anterior), confira portas livres e remova perfis e cópias com segredos de teste.

## Regras do projeto

- Nada de `sed -i`, `perl -i`, `python` ou edição de arquivo por shell: use as ferramentas de edição. Nada de `sleep` em primeiro plano longo.
- **Máximo de 2 processos pesados ao mesmo tempo** (jest, tsc, nest build, backend). Muitos jest em paralelo já reiniciaram esta máquina. Use `npx jest --maxWorkers=2`.
- Corrija o que achar com teste verde antes e depois. Commits pequenos, caminhos explícitos (nunca `git add -A`), prosa normal, `fix(whatsapp): ...`, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Nunca amend nem reset. **Sem push.** `index.lock` = espere e repita.
- `strictNullChecks` está desligado; trate `null` explicitamente. Matriz de fuso `TZ=UTC`, `America/Sao_Paulo`, `Asia/Tokyo` nos testes de `src/conversation` e `src/whatsapp`, um de cada vez.
- Dúvida de contrato: registre em `.superpowers/sdd/whatsapp-item-5/duvidas.md`, siga com a leitura mais segura e avise. Não decida o que a seção 14 do contrato reserva ao dono.

## Entrega

Escreva `.superpowers/sdd/whatsapp-item-5/resultado-rev-5a.md` (e commite): achados e correções (com severidade), tabela dos mutantes (o que mudou, qual teste matou, ou teste novo), resultado de cada cenário de integração, números reais de `tsc`, `nest build`, `jest` (suíte inteira e matriz de fuso), o que **não** foi verificado, e o estado da limpeza. Responda no fim com um resumo curto.
