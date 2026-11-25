# Textos de tom (12.0b-2)

Revisar antes do merge (contrato 12.0b, secao 7, decisao 4). Fonte: `backend/src/conversation/tone/tone.texts.ts`.

Regra de escolha: variante = hash FNV-1a do messageId que abriu o rascunho, mod 3. Mesmo messageId, mesma variante.
Placeholders `{valor}`, `{descricao}`, `{cartao}`, `{meta}`, `{total}`, `{parcelas}` sao dados ja validados (nunca texto livre).

## Tipos e tom

| Tom | Usado em | Emoji |
|---|---|---|
| ALEGRE | receita (sem palavra sensivel) | 1 |
| CELEBRANDO | guardar em meta/caixinha (sem palavra sensivel) | 1 |
| NEUTRO | despesa (sempre); qualquer tipo com palavra sensivel | 0 |
| ATENTO | parcelado (sem palavra sensivel) | 0 |

Apagar e editar lancamento continuam com o texto neutro atual (fora desta mudanca).

## Variantes

### ALEGRE, rascunho (entendi, antes de confirmar)

1. Que boa! Entrou {valor} de {descricao} 🎉
2. Show! Anotei {valor} de {descricao} como receita 🎉
3. Boa! Vou registrar {valor} de {descricao} 🎉

### ALEGRE, recibo (depois de gravar receita)

1. Feito! Entrou {valor} de {descricao} 🎉
2. Registrado! Entrada de {valor} de {descricao} 🎉
3. Que boa! {valor} de {descricao} registrados 🎉

### CELEBRANDO, rascunho (guardar em meta)

1. Boa! {valor} pra {meta} 💪
2. Ótimo! Vou guardar {valor} em {meta} 💪
3. Show! {valor} entrando em {meta} 💪

### CELEBRANDO, recibo (guardar em meta)

1. Guardado! {valor} em {meta} 💪
2. Mais um passo: {valor} em {meta} 💪
3. Feito! {valor} em {meta} 💪

### NEUTRO, rascunho (despesa e sensivel)

1. Anotei: {valor}, {descricao}.
2. Entendi: {valor}, {descricao}.
3. Confira: {valor}, {descricao}.

### NEUTRO, recibo (despesa e sensivel)

1. Anotado: {valor}, {descricao}{cartao}.
2. Pronto, anotei {valor}, {descricao}{cartao}.
3. Registrado: {valor}, {descricao}{cartao}.

### ATENTO, rascunho (parcelado)

1. Entendi: {descricao} em {parcelas}x, total {total}.
2. Certo, compra parcelada: {descricao} em {parcelas}x, total {total}.
3. Confira: {descricao} em {parcelas} parcelas, total {total}.

### ATENTO, recibo (parcelado)

1. Parcelamento anotado: {descricao}, {parcelas}x, total {total}.
2. Pronto: {descricao} em {parcelas}x, total {total}, registrado.
3. Compra parcelada registrada: {descricao}, {parcelas}x, total {total}.

## Palavras sensiveis (radicais, sem acento, inicio de palavra)

Casam com a descricao ou a categoria. Forcam tom NEUTRO.

- `saude`
- `hospit`
- `remedi`
- `medic`
- `exame`
- `doenc`
- `funer`
- `velori`
- `enterr`
- `luto`
- `divid`
- `multa`
- `cobranc`
- `dentist`
- `internac`
- `cirurg`

## Textos de ensino (ajuda e dicas)

- Ajuda: "gastei 50 no mercado", "recebi 3000 de salario", "caiu 500 do freela", "comprei um celular em 10x de 150", "coloquei 200 na minha caixinha".
- Dica da folha Lancar despesa: "gastei 50 no mercado". Lancar receita: "caiu 500 do freela". Guardar numa meta: "coloquei 200 na minha caixinha".
- Valor ausente: `Não encontrei o valor. Ex.: "gastei 50 no mercado".`
