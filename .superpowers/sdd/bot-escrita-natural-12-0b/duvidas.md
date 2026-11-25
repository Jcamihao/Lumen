# Duvidas de produto: brief 12.0b-1 (escrita natural)

Data: 2026-11-25. Nada aqui foi decidido pelo agente sem registro. Padrao aplicado esta entre parenteses.

1. Aporte sem destino ("guardei 200", "poupei 80"): o brief pede "poupei 80" como positivo, mas a suite atual
   tem "guardei 200" como negativo (intent.matcher.spec.ts). Regra aplicada: verbo informal de guardar so casa
   com valor E com alguma palavra de destino depois ("na viagem", "no cofrinho", "na caixinha"). Logo "poupei 80"
   e "guardei 200" continuam fora. (Padrao: manter o teste atual; confirmar se "poupei 80" deve virar aporte que
   pergunta a meta.)
2. "criar caixinha X": mapeado como "criar meta X" (pede alvo se faltar). Alternativa: "criar cofrinho X"
   (sem alvo). (Padrao: como meta.)
3. "gastei 50 no mercado ontem?" e qualquer lancamento com "?" deixaram de virar rascunho, inclusive os verbos
   antigos (gastei/paguei/comprei/recebi/ganhei). Antes, "gastei 50 mercado?" gerava rascunho. Mudanca de
   comportamento de frase que ja casava; feita porque o brief item 5 lista essa frase como negativa.
   (Padrao: pergunta com "?" nao grava.)
4. Parcelado com data depois do valor ("comprei um celular em 10x de 150 ontem") nao casa. O parcelado existente
   so aceita "primeiro <data>" no fim. (Padrao: nao casa, vai ao Selah.)
5. Parcelado: "de 150" e lido como valor da parcela e o total vira 150 x N (ex.: 1500,00). O contrato escreve o
   valor sem dizer se e parcela ou total; o brief pede reusar o caminho existente, que recebe total. (Padrao:
   "de V" = parcela.)
6. Palavras de enchimento aceitas entre verbo e valor: so, ja, ai, uns, cerca, exatos, mais (no maximo 1).
   Lista escolhida pelo agente. (Padrao: esta lista.)
7. Ponto final no fim da frase continua indo para a descricao ("35 no uber."). Comportamento anterior de
   "gastei 35 no uber." mantido, nao tratado aqui.
8. "50 reais" continua com "reais" na descricao (a suite atual fixa "2 mil reais" -> rest "reais").
   "conto/contos" sai do texto como sufixo de valor. (Padrao: so conto/contos e removido.)


## 12.0b-2 (dono)
1. Mensagens de boas-vindas dos adaptadores (`telegram-adapter.service.ts`, `whatsapp-adapter.service.ts`) e a dica do `receipt-extractor.types.ts` ainda citam "50 mercado". Trocar para "gastei 50 no mercado"? (padrao: sim; nao mexi nesta fatia por estar fora da lista de escopo).
2. Lista de radicais sensiveis (`tone/tone.texts.ts`, SENSITIVE_STEMS) e de palavras para revisar: aprova ou ajusta? Radical "divid" casa "dividir" (vira neutro sem prejuizo).
