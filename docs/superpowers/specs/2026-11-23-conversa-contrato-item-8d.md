# Contrato do item 8d: mexer no limite do cartão por conversa (com os cartões do 9a)

Rascunhado pelo Qwen em 2026-11-23 a partir do código da `develop`. **Status: APROVADO pelo dono em 2026-11-23 ("sim" em D1–D3 — as propostas viraram o texto definitivo).**

## 1. Situação hoje (lido no código em 2026-11-23)

- O "limite" é o **teto do ciclo aberto** (`CreditCycleCeiling` por cartão + data de fechamento). O chat já tem `definir limite` (rascunho `CREDIT_LIMIT`, snapshot do ciclo/teto com conflito `CreditLimitChangedError` na confirmação) — mas grava **sempre no cartão padrão** (`setCeilingForConversation` não recebe cartão).
- O 9a trouxe vários cartões nomeados; a tela já define teto **por cartão** (`PUT /credit-cards/:id/ceiling` → `setCeilingForCard`). O chat ficou preso ao padrão — "definir limite do Nubank" hoje não existe.
- **Remover/limpar teto não existe em lugar nenhum** (nem tela, nem serviço): só upsert.

## 2. Escopo

- **Mudar** limite por cartão pelo chat: `limite do <nome>` / `mudar limite do <nome>` — mesma máquina do rascunho `CREDIT_LIMIT` atual, escolhendo o cartão pelo nome (termo desconhecido → pede reenvio listando os cartões), padrão quando sem nome. Mesma conferência de snapshot na confirmação.
- **Limpar** o teto do ciclo: nova semântica — D1. Se aprovada: método novo no `CreditCycleService` (`removeCeilingForConversation`) com o mesmo lock/snapshot, e no chat `limpar limite [do <nome>]` com prévia + palavra de confirmação (jeito do 8a: resposta exata `limpar`), porque destrói um controle financeiro.
- Frontend: nada além de rótulos se algo novo aparecer (cartão é o mesmo).

## 3. Decisões do dono (APROVADAS em 2026-11-23 — "sim" em D1–D3; não perguntar de novo)

- **D1** — `limpar limite` pode existir? Sem teto o ciclo passa a não ter aviso de estouro. Se não, 8d fica só "mudar/definir por cartão".
- **D2** — escolha de cartão pelo nome no chat (termo sem acento/caixa, como a busca do 8b), ou o chat segue só no cartão padrão?
- **D3** — confirmar a limpar com a palavra `limpar` (e botão com flag no cartão, como o `apagar` do 8a-2)?

## 4. Verificação

Igual às fatias anteriores: spec na máquina de rascunhos, mutantes, integração real em Postgres/Redis descartáveis (incluindo dois cartões na mesma conta e snapshot velho barrado).
