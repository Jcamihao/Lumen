# Revisao users (lote 1) - 2026-11-27, conferido por Sonnet 5.5 (agente revisor)

## Veredito
Sem defeito de comportamento. Nenhum vazamento. 3 specs novos adicionados (so testes; codigo de producao intocado).

## Conferencia linha a linha
- exportMe: mesma consulta (include/orderBy/select de authSessions sem refreshTokenHash), mesmos omitidos no profile (passwordHash, mfaTotpSecretEncrypted, mfaPendingTotpSecretEncrypted, mfaRecoveryCodes + 17 listas), mesma ordem de chaves (topo, profile, datasets), mesmas conversoes Number. Nota: mfaLastTotpStep continua no profile do export, igual ao original (nao e regressao; ver "Riscos").
- createUser: transacao user+cartao, hash repassado, clamp 1..31 com default 30, consentimento (IA so com aviso), catalogo padrao e ordem do Promise.all identicos.
- updateMe/deleteMe/updatePassword/markEmailVerified/updateLastLogin: mesma ordem (404, guarda IA, transacao), mesmos where. sanitizeUser oculta 5 campos, igual ao original.
- DI: users.module.ts e users.controller.ts sem diff; construtor UsersService(prisma, configService) igual; consumidores em src/auth/** inalterados.
- Tamanhos: todos os arquivos novos <=120. Funcoes <=20, exceto findById (22, igual ao original, aceito). users.service.spec.ts (251) ja existia.
- Duplicacao: mensagem "Usuario nao encontrado." repetida 4x (igual ao original). Aceito.

## Mutantes
Rodada 1: 70 mutantes. Rodada 2 (apos novos testes + reescrita dos que nao compilavam): 24. Total 94 execucoes.
- Mortos por teste: todos os de vazamento (omit de cada campo sensivel no export e no sanitize, refreshTokenHash no select, mfa flags, guarda de consentimento, hash, clamp, tx, where de userId etc.).
- Mortos por erro de tipo (ts-jest, nao por teste): export sem where userId; task categories sem userId; update sem where; updatePassword sem where; delete sem where; delete lookup sem where. Reescritos com where de outro id e mortos por teste.
- Sobreviventes da rodada 1 (15): errorPercent undefined (equiv?); unitPrice truthy (equiv?); privacy usa user cru (sem efeito?); sanitize sem toCategoryResponse; findByEmail where; findById sem orderBy; findById sem 404; create fora do tx; update fora tx; markEmailVerified sem emailVerifiedAt null; markEmailVerified sem data; updatePassword nao grava; updateLastLogin nao grava; updateMe sem 404; privacyAt sempre now.
  Mortos pelos novos testes: todos, menos os equivalentes abaixo.
- Sobrevivente real da rodada 2: "delete lookup where outro id" (busca do hash de senha sem escopo). Morto por src/users/account/account-deleter.spec.ts.
- Equivalentes (validados):
  1. unitPrice truthy: Prisma devolve Decimal (objeto, sempre truthy) ou null; igual a !== null.
  2. errorPercent sem checar undefined: coluna Decimal? nunca vem undefined do Prisma; so null/Decimal.
  3. retorno do create so com id: createUser usa apenas user.id.
  4. privacy usa user cru em vez de toAccountFields: le so campos que nao sao omitidos.

## Testes novos
- src/users/users.service.account.spec.ts (101 linhas): findByEmail, findById (consulta e 404), updatePassword, markEmailVerified, updateLastLogin, updateMe 404 e transacao, data do aviso preservada, sanitizeUser converte categorias.
- src/users/users.service.create-tx.spec.ts (29): user e cartao pelo cliente da transacao.
- src/users/account/account-deleter.spec.ts (21): where por userId na busca da senha e no delete.

## Numeros verdes (2026-11-27, revisor)
- npx jest src/users: 7 suites, 39 testes, 23 snapshots.
- TZ=UTC, America/Sao_Paulo, Asia/Tokyo: 39/39 em cada.
- 15 execucoes seguidas em UTC: 15 ok.
- npx tsc --noEmit | grep '^src/users': vazio.
- Arquivos de src/users: md5 igual ao inicio, exceto os 3 specs novos.

## NAO verificado
- Banco real/Postgres: tudo com Prisma mockado; ordem real de colunas/consultas nao testada em contêiner.
- Novos specs nao rodados contra o users.service.ts antigo (sem checkout/stash por regra); escritos para o comportamento original.
- Suite fora de src/users (auth etc.) nao rodada; so tsc de src/users.
- Snapshots foram gerados pelo implementador no codigo antigo; nao regerei.

## Riscos aceitos
- exportMe inclui mfaLastTotpStep no profile (igual ao original). Dado tecnico de anti-replay TOTP, nao e segredo reutilizavel, mas fora do espirito do omit; decisao do dono se quiser omitir (muda comportamento).
