# Contrato do item 9b: o bot conhece os cartões (decisões do dono de 2026-11-24 aplicadas; falta 1 pergunta, ver seção 7)

Data: 2026-11-24. Base: develop com 9a (cartões no backend) e 8d (limite por cartão pelo nome, "limpar teto"). Só backend (bot); telas são a 9c.

## 1. Situação hoje (lido no código)
- 8d já faz: "definir limite do Nubank 2000" e "limpar limite do Nubank" (cartão pelo nome, ambíguo/inexistente respondem com a lista).
- **Falta:** (a) lançar gasto num cartão ("gastei 50 mercado no Nubank"); hoje o rascunho de despesa nasce com `paymentMethod: null` e sem `cardId`; (b) a leitura "cartão"/"limite" (`credit_card`) mostra só o cartão padrão; (c) não há "meus cartões"; (d) nenhuma pergunta de escolha quando há mais de um cartão.

## 2. Escopo proposto da 9b
1. **Lançar no cartão:** em despesa, o trecho "no/na/do/da <cartão>" (ou "no crédito <cartão>") resolve o cartão pelo nome (mesma busca sem acento/caixa do 8d, `matchCardsByTerm`), grava `paymentMethod=CREDIT` + `cardId` e mostra o cartão no rascunho e no recibo. Nome inexistente/ambíguo: responde com a lista de cartões, sem gravar.
2. **Sem cartão na frase:** comportamento de hoje (nada muda; crédito sem cartão continua contando no padrão, regra da 9a). Sem pergunta extra.
3. **Leitura por cartão:** "limite do Nubank", "quanto sobrou no Nubank", "gastei quanto no Nubank" → mesmo cartão de ciclo do `credit_card`, para o cartão nomeado (`getCycleForCard`). Sem nome: padrão, como hoje.
4. **Listar:** "meus cartões" → nomes, qual é o padrão, dia de fechamento/vencimento. Só leitura.
5. **Parcelado e conta fixa por conversa** com cartão: mesmo trecho "no <cartão>"; herdam como na 9a.
6. **Editar lançamento (8b):** trocar o cartão ("mudar cartão do mercado para Itaú") **fica fora**; o 8b não mexe em cartão.

## 3. Fora da 9b
Criar, renomear, arquivar ou trocar o padrão de cartão por conversa (fica nas telas, 9c); limite de cartões por plano (depois do billing); alerta de insight por cartão; fatura com data de pagamento.

## 4. Regras
- Isolamento A/B/C: o cartão sempre buscado por `userId` do vínculo autenticado; cartão alheio = "não achei" igual a inexistente (sem revelar existência).
- Escrita pelo mesmo caminho da tela (`withCardGuard`, `resolveCardForCreate`), recibo com `cardName`; 3 resultados de gravação preservados; cartão arquivado entre rascunho e confirmação: conferido na confirmação e recusado.
- Palavra "no/na" é ambígua ("gastei 50 no mercado"): só vira cartão se o termo casar com um cartão do dono; senão continua descrição (nada muda para quem não tem o nome igual). Cartão com nome igual a loja é limitação aceita (o dono renomeia).
- Sem mudança de schema nem migration.

## 5. Verificação
Unitários dos parsers (acentos, conectores, nome ambíguo, nome que é também descrição), isolamento A/B/C pelo fixture da conversa, integração real em Postgres/Redis descartáveis (rascunho → confirma → `cardId` gravado; cartão arquivado no meio; concorrência com make-default), mutantes (≥10), 3 fusos, suíte inteira, conferência independente.

## 6. Decisões do dono (2026-11-24)
1. "No <cartão>": o bot confere se o cartão existe. Existindo, grava crédito + cartão. Não existindo, **pergunta/lista os cartões** e não grava. O usuário precisa poder **nomear os cartões** para falar com o bot pelo nome (nome já existe na 9a; ver seção 7).
2. Crédito sem nome de cartão: com **um** cartão, usa ele e mostra o nome no recibo; com **mais de um**, o bot **mostra a lista** e o usuário escolhe em qual gastou (rascunho espera a escolha, como os outros campos pendentes).
3. Parcelado e conta fixa: **fora da 9b**, entram numa 9b2.
4. Trocar cartão de lançamento existente: **fora**.

## 7. Pergunta aberta
"Nomear os cartões" = (a) só pelas telas/API (já pronto na 9a; telas na 9c) ou (b) também **criar/renomear cartão por conversa** ("criar cartão Nubank", "renomear Principal para Nubank")? Recomendação: **(b) em fatia própria 9b-nomear** (precisa de limite técnico de 10, nome único, confirmação), porque sem isso o usuário que só tem o "Principal" não consegue falar pelo nome antes da 9c.
