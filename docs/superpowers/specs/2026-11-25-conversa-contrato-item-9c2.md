# Contrato item 9c-2 — tirar o espelho do User (cartão vira fonte única)

Data: 2026-11-25. Dono liberou com "vai pra 9c-2" sem detalhes; como na 10, estas
decisões viram **contrato da própria sessão**, documentadas como assumidas — o dono
revisa e veta o que quiser. Base: `.superpowers/sdd/cartoes-telas-9c/prompt-retomada-9c.md`
passo 5 e contrato do item 9 (`2026-11-23-conversa-contrato-item-9.md`, seção 4.2 —
"espelho do User até o front migrar"; a 9c-1 migraria).

## Escopo
Remover `monthClosingDay`, `creditDueDay` e `creditCycleCountAllPayments` do `User`.
O `CreditCard` (padrão) passa a ser a fonte única desses três valores, como já é para
os outros cartões desde a 9a. Fim do espelho da 9a.

## Decisões assumidas
- **D1 — remove com migration** que dá `DROP COLUMN` nas três colunas de `User`
  (sem fase de deprecated: o único consumo restante é interno). Migration escrita à
  mão em SQL (armadilha registrada: `prisma migrate dev` propõe derrubar os índices
  únicos parciais de `CreditCard`); conferida em descartável com `migrate deploy` +
  `migrate diff` limpo.
- **D2 — cadastro mantém o campo "dia de fechamento"** (UI e `RegisterDto.monthClosingDay`
  ficam), mas o valor vai direto para o `closingDay` do cartão Principal (clamp 1..31,
  padrão 30). Cadastro passa a criar só o cartão, sem espelho no User.
- **D3 — `PATCH /users` perde `monthClosingDay`** (path legado: o front de Configurações
  já não o envia; Cartões edita pelo cartão desde a 9c-1). Campo sai do DTO.
  Se vier payload com a chave, passa batido (whitelist do ValidationPipe).
- **D4 — fim da duplicação**: a tela de Cartões **para de editar** "Teto do ciclo" e o
  escopo (soma tudo / só crédito). O lugar único do teto passa a ser o **card do ciclo**
  no `/finance`, que desde a 9c-1b tem abas por cartão com teto próprio e o botão
  "Limpar teto" (9c-1c). APIs `/credit-cycle/*` continuam como estão (bot e card do
  ciclo usam).
- **D5 — insights** leem o cartão padrão: `closingDay` com fallback 30 quando não há
  cartão (usuário sem Principal é estado corrompido, não erro) e `dueDay` do cartão.
  Sai qualquer leitura do espelho.
- **D6 — bot e motor não mudam**: já operam por cartão (9b/9c-1c).

## Checagem antes de aplicar em produção (substitui a da 9a-3 para este deploy)
A migration da 9a converteu os valores do User em dados do cartão com clamp 1..31
(ver `resultado-9a3.md` — o SELECT antigo continua válido para ambiente que ainda não
rodou a 9a). Mas entre a 9a e esta fatia, o `PATCH /users` legado podia escrever
`monthClosingDay` **sem tocar no cartão** (D3 o matava pela metade). Antes do deploy da
9c-2, rodar:

```sql
SELECT u."id", u."email", u."monthClosingDay", c."closingDay", u."creditDueDay", c."dueDay", u."creditCycleCountAllPayments", c."countAllPayments"
FROM "User" u JOIN "CreditCard" c ON c."userId" = u."id" AND c."name" = 'Principal'
WHERE u."monthClosingDay" IS DISTINCT FROM c."closingDay"
   OR u."creditDueDay" IS DISTINCT FROM c."dueDay"
   OR u."creditCycleCountAllPayments" IS DISTINCT FROM c."countAllPayments";
```

Linha devolvida = dessincronizado pelo path legado: atualizar o cartão a partir do
User (o dono mexeu por último pelo path antigo) antes de subir. Rodar também o SELECT
de clamp do `resultado-9a3.md` se o ambiente ainda não rodou a migration da 9a.

## Fora do escopo
- Nada de UI nova; remover o bloco duplicado é subtração.
- Cache offline da lista de cartões, textos de erro, padrão Esc unificado: continuam
  aceitos como estão.
- `deploy`/`master`: nada. Merge até a `develop`, tag local.

## Verificação esperada
tsc; jest inteiro em 3 fusos com specs ajustados (users/auth/insights/credit-cycle/
credit-cards); karma inteira; `ng build`; integração em descartável: cadastro → só
cartão com o dia escolhido; `PATCH /users` com `monthClosingDay` não muda nada no
cartão nem no User (coluna não existe); tela de Cartões sem o bloco de teto; card do
ciclo segue salvando/limpando teto; migration com `migrate diff` limpo. Relatório em
`.superpowers/sdd/cartoes-telas-9c/resultado-9c2.md` com seção NÃO verificado.
