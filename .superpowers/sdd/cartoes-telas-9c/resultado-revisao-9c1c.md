# resultado-revisao-9c1c — Revisão e verificação do 9c-1c (cartões nas telas)

Revisão: este agente (dono pediu Qwen apenas, sem Sonnet). Data: 2026-11-25.
Commits revisados: `b43271a..7303002` + commits desta revisão:
- `337cb93` fix(Esc do confirm de limpar teto não fechava com foco no body)
- `ce3e68b` test(karma): guarda anti-repetição do refresh ao limpar teto (mata o mutante F3)

## Veredito
**9c-1c APROVADO.** Core correto, transações/lock/bot-parity/exaustão conferidos, mutantes mortos (12/13, 1 equivalente), achado real de UX corrigido nesta revisão.

## Verificações da revisão (ambiente descartável ~/tmp-lumen: Postgres 18.6 + Redis 8 binários nas portas 5546/6392, backend 3100, SPA 4300)
- **API (16 checks, `rv9c-api.mjs`)**: corpo do recibo de limpar (`message/type/cards`) ✓; 409 "não possui teto definido" sem limpar teto ✓; 409 cartão arquivado ✓; **404 id alheio == 404 inexistente por status+mensagem** ✓; 401 sem token ✓; paridade bot: limpar via rascunho apaga ✓, "não há teto" 200-semântico ✓, **rascunho obsoleto com snapshot divergente → texto de limite mudado, nada apagado** ✓.
- **Concorrência (`rv9c-race.mjs`, 105 operações)**: DELETE×PUT×make-default×archive×bot-clear em 2 cartões de 2 donos → 0 falhas, 0 deadlocks/57P0x, invariantes por cartão consistentes com a última escrita vencedora (PUT é upsert; PUT−DEL não é invariante), 1 leitura intermediária <2ms registrada como ambiguidade entre PUT e GET (não violação).
- **Chrome real (`rv9c-chrome.mjs`, 12/12)**: UI limpa → limpa com recibo → recibo some; 500 → "⚠️ Não consegui limpar o teto agora."; 409 sem teto → mensagem do backend na banner; 409 arquivado idem; Esc fecha (antes do fix falhava de verdade); duplicado bloqueado; Enter no slot vazio não apaga. Screenshots em `~/tmp-lumen/shots-9c/`: 390 e 1280 claro/escuro — alinhamento com o card, sem overflow.
- **Mutantes (7, `mutantes-9c1c.sh`)**: A1/C1/D2/E1 (service) e B1/B2/F3 (componente) mortos por testes existentes/novos. **B4 equivalente**: `?? 7` inalcançável porque o único chamador sempre passa `removedCents` (verificado com throw).
- **Conferência completa na branch**: tsc ok; jest 3 TZs (credit-cards/credit-cycle/conversation/telegram) 1177 testes×3; jest completo 90 suites/2308; karma completa **533/533**; `ng build` ok; `graphify update` ok.

## Achado real corrigido nesta revisão
O confirm do "Limpar teto" só fechava com Esc se o foco estivesse no componente. Em Chrome real, clicar no botão com o mouse deixa o foco no `body` → Esc não fechava (karma com dispatch em `document` e o teste antigo com foco no input mascararam o caso). Corrigido com listener no window (`@HostListener keydown.escape`, guardado por `confirmingClear()` — Esc com foco editando outro campo não fecha). O teste antigo que despachava no input foi atualizado para o evento real (bubbling do campo). O formulário de EDIÇÃO do teto (9c-1b) tem a mesma limitação histórica (Esc só com foco num campo, que é natural lá) — deixado como está, registrado como pendência de padrão de UI.

## Redescoberta importante (ferramental)
O service worker do PWA (`ngsw` do `ng build`) mantém controle da página mesmo após `getRegistrations().unregister()+update()` — requests ficam invisíveis ao CDP `Fetch` e a injeção de falha não funciona. Solução: iniciar Chrome com `--disable-features=ServiceWorker` + reload antes de habilitar a interceptação (registrado aqui e na nota do release).

## Armadilha de boot do backend (registrada na revisão)
O `ConfigModule` do backend lê **somente o `.env` da raiz do repositório** (arquivo do dono, aponta para `localhost:5433`) — `backend/.env` NÃO é lido por ele. Subir backend de teste SEMPRE com env inline: `env PORT=3100 DATABASE_URL=... REDIS_URL=... JWT_SECRET=... node dist/main.js`. Sem `PORT` ele tenta a 3000 (porta do orquestrador-ia-server-1 do dono — a colisão EADDRINUSE protegeu, nada foi roubado). Sem env inline ele tenta o 5433 do dono (a conexão nem completou, nada foi lido/escrito lá).

## Perguntas de produto do prompt (recomendações aplicadas — dono fora, "aceitar")
- Erro nas abas de cartões offline: **aceitar** como está (banner no bloco, sem retry automático).
- `/start` do Telegram: **aceitar** comportamento atual.
- Esc duplicar/limpar: **manter**; decisão de unificar padrão fica para o 9c-2.

## NAO verificado (registrado)
- Fluxo com WhatsApp real de ponta a ponta (testado só pela API HTTP do bot).
- Pagamento/checkout real (fujo de checkout real — regra da retomada).
- Migração em Postgres 16 real do docker do dono (aqui: bins PG 18.6 — migrações são as mesmas do develop, `prisma migrate status` limpo).
- E2C do teto no resumo (explícito no brief: NÃO testar — 9c-2 resolve).
- Acessibilidade completa (aria-live usado; sem auditoria de leitor de tela).
