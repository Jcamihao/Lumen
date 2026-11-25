# resultado-9c2 — Cartão fonte única do ciclo (fim do espelho no User)

Data: 2026-11-25. Execução: Qwen (OpenCode), sessão única, sem subagentes.
Contrato: `docs/superpowers/specs/2026-11-25-conversa-contrato-item-9c2.md` (decisões
da sessão assumidas com o "vai pra 9c-2" do dono; D1–D7 lá).
Commits (branch `feat/cartoes-9c2`, base `develop` `5d333b7`):
- `0914f1a` docs: contrato da fatia
- `2b8f4a4` refactor(credit-cards): cartão padrão vira a fonte única (+migration +specs)
- `3d587d9` refactor(cartoes): tela de Cartões para de editar teto/escopo (+karma)
- `b167e21` docs: ajuste do contrato (PATCH antigo já sincronizava; chave vira 400)

## O que mudou
- **Schema/migration**: `monthClosingDay`, `creditDueDay`, `creditCycleCountAllPayments`
  removidos de `User`; migration `20261125120000_drop_user_cycle_mirror` dá `DROP COLUMN`
  nas três (SQL escrita à mão; `migrate diff` migrations→schema "No difference
  detected"; os DOIS índices únicos parciais de `CreditCard` seguem intactos no banco real).
- **Cadastro**: o dia coletado no formulário vai direto para `closingDay` do cartão
  Principal (clamp 1..31 no serviço; `RegisterDto.monthClosingDay` mantido como entrada).
- **Fim dos espelhos**: `userCycleFieldsFromCard`/`syncUser` mortos; `updateSettings` e
  `PATCH /credit-cards/:id`/`makeDefault` gravam só o cartão.
- **`PATCH /users` perde `monthClosingDay`** (sai do DTO; `forbidNonWhitelisted` → 400
  para client que ainda mandar a chave — nenhum client do repo manda).
- **Insights** leem `closingDay`/`dueDay` do cartão padrão (fallback 30/null).
- **Tela de Cartões (D4)**: bloco "Ciclo atual / Teto do ciclo / Escopo do teto"
  removido (HTML/TS/SCSS); lugar único do teto = card do ciclo em Finanças (9c-1b/1c,
  intacto). Saiu também o espelho `monthClosingDay` do `User` do front e do stub offline.

## Verificação (números desta rodada)
- Backend `tsc --noEmit` limpo; foco users/auth/insights/credit-cycle/credit-cards **292**
  verdes com os specs reescritos para o novo contrato (asserts de espelho viraram
  asserts de "não toca no User").
- Integração real (`integracao-9c2.mjs`, Postgres 18.6 + Redis 8 binários em 5546/6392,
  backend em **3100**): **16/16** — cadastro cria só o Principal com o dia escolhido;
  `/users/me` sem os campos-espelho; `PATCH /users/me` com chave velha → 400 sem mudar
  nada; settings/current/teto operando no cartão; editar o cartão move o ciclo.
- Regression da 9c-1c (`rv9c-api.mjs`) reaplicada nesta build: **16/16** (API + bot
  parity + 404/409/401 + rascunho velho sem apagar).
- Ambiente descartável derrubado no fim, portas 5546/6392/3100 sem listener; containers
  do dono intocados (ver nota do incidente abaixo).
- Conferência completa (jest inteiro, 3 fusos, ng build, karma inteira, graphify):
  números no bloco final abaixo.

## Queda do orquestrador do dono (investigada, NÃO é desta sessão)
No teardown, `docker ps -a` mostrou `orquestrador-ia-server-1/web-1` exitados (137/0)
~2h antes. Evidências de que não fui eu: (a) os cmds dos containers são
`node src/index.ts` e `nginx` — meu padrão `pkill 'dist/main[.]js'` não casa;
(b) logo após meu primeiro pkill do dia, o `docker ps` desta sessão ainda os mostrou
RODANDO; (c) a queda (137 = SIGKILL, cheira a OOM/system) é posterior àquele pkill.
Falso alarme meu também registrado: o log `LUMEN API running at http://localhost:3000`
mostra o `APP_URL` do `.env` da raiz, NÃO a porta bindada — `ss -ltn` confirmou que
todos os boots desta sessão escutaram em 3100. A 3000 nunca foi tocada.
Restaurado: orquestrador provavelmente precisa de `docker start` (ação do dono).

## NÃO verificado
- Migração em Postgres 16 real do docker do dono (testado em bins 18.6; SQL é trivial DROP COLUMN).
- Deploy real com dados reais: o SELECT de paranoía do contrato (User vs Principal
  dessincronizados) não foi rodado contra banco do dono (proibido tocar 5433).
- Chrome real na tela de Cartões pós-remoção (karma cobre componente; visual
  "tela mais curta" não fotografado).
- Clients externos antigos que mandassem `monthClosingDay` em `PATCH /users` passam a
  receber 400 — nenhum existe no repo, mas se o dono tiver script fora do repo, é aqui.

## Números da conferência completa
Pré-merge (branch) — `conferencia-9c2.sh`: jest inteiro **91 suítes/2354**; foco
4 módulos **1193×3 fusos** (UTC/America/Sao_Paulo/Asia/Tokyo); `ng build`
(hash 9f521f6c6c41355f); karma inteira **547 SUCCESS**; `graphify update` ok.
Pós-merge com develop (`conferencia-9c2-posmerge.sh`, develop trouxe a 11b-1a):
jest inteiro **94 suítes/2412**; foco 1193×3; `ng build` ok; karma **547 SUCCESS**;
regression API pos-merge: integracao-9c2 **16/16** + rv9c-api **16/16**; migrations
deployadas limpas do zero (ordem 120000 minha + 130000 da 11b sem colisão);
ambiente derrubado, portas 5546/6392/3100 sem listener.
Nota do dia: o guard de performance do `receipt-text.parser.spec.ts` (500ms) flakou
uma vez sob carga paralela e passou isolado e em `maxWorkers=2` — flake de máquina,
não produto.
