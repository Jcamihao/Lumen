# Resultado da revisao - bot perguntas naturais (feat/bot-perguntas-naturais)

Revisor: Claude Sonnet 5.5, 2026-11-25.

## Veredito
Aprovado com correcoes (ja feitas). Defeito da duvida 1 corrigido. Sem regressao nas suites.

## Achados e correcoes
- A1 (defeito, corrigido): prefixo antigo 'quanto tenho' mandava para saldo "quanto tenho guardado/de reserva/de limite/de fatura/de parcela/que pagar" e "quanto tenho que guardar ... carro de 50 mil". Agora o prefixo antigo vale so na frase exata 'quanto tenho' (intent.matcher.ts). O resto vai ao leitor novo: guardado/reserva -> envelopes, limite/fatura -> credit_card, parcela -> installments, que pagar -> upcoming_dues, nao casa -> null (Selah). "quanto tenho hoje / disponivel / de saldo na conta / de dinheiro / esse mes / no momento / de grana" seguem saldo (nucleos novos).
- A2 (falso negativo, corrigido): girias e informal: q, qnt, qto, vc, voce, sabe, hj, pf, pfv, manda, mande, passa, bora, momento como enchimento; saudacao no inicio (bom dia / boa tarde / boa noite) so no comeco; "?" solto no meio ("quanto ? tenho") nao quebra; "como ta a fatura do Nubank" (ta como lead de cartao).
- A3 (cobertura nova, baixo risco): nucleos "tem saldo", "com conta", "grana", "tenho grana", "com grana", "vida financeira", "devo pagar", "contas tenho pagar", "meta", "falta meta", "guardei", "pago contas fixas", "tenho disponivel" e similares.
- Cuidado: "bom"/"boa" soltos NAO sao enchimento ("meu saldo e bom?" fica null).
- Deixado de fora de proposito (vai ao Selah): "quanto tenho no banco/na carteira/na conta do nubank/no nubank/no cartao/a receber/de divida", "quanto ganhei", "quanto devo de luz", "quanto estou devendo", "quais sao minhas despesas", "minhas despesas do mes", "meta de viagem", "mano qual o meu saldo" (palavra desconhecida), "qual o seu saldo".

## Riscos antigos (nao do leitor novo, registrados, nao mexi)
- Prefixos antigos 'saldo' e 'resumo' (startsWith): "saldo negativo e ruim", "saldo da minha tia", "resumo do livro", "resumo da novela", "resumo da semana" viram balance/month_summary.
- "quanto gastei no mercado/ifood" e "como ta a fatura da luz" viram credit_card loose (nome de cartao inexistente): depende de como o servico trata cardTerm loose sem cartao (fluxo existente, nao revisto).
- "quanto voce tem de saldo" casa saldo (inofensivo).
- Performance: cada matcher faz O(palavras) com Set/Map, max 12 palavras; sem regex pesada. Sem achado.

## Duvidas 2, 3, 4 (mantidas como estao, sem decisao)
2: com "?" e nome de cartao sem a palavra cartao continua null (so "como/qual" aceitam "?"). 3: "hoje" = total do mes. 4: "quanto devo no X" = fatura do cartao.

## Duvida de produto nova (dono decide)
- Frases como "quanto tenho na conta do nubank" / "quanto tenho no nubank" agora vao ao Selah (antes caiam em saldo geral). Quer que virem leitura do cartao/conta? Nao decidi.

## Commits da revisao
- 0bfe970 fix(conversation): prefixo 'quanto tenho' so vale na frase exata; girias e saudacao no leitor natural
- c62018a test(conversation): prefixo 'quanto tenho', girias e negativos
- test(conversation): cobre mutantes sobreviventes
- docs(conversation): esta pasta

## Testes
~90 frases naturais proprias conferidas antes/depois (script ts-node descartavel, em scratchpad); diferencial de 90 variacoes de "quanto tenho X": todas balance ou null, nenhuma mudanca errada.

## Mutantes proprios (26)
Mortos 22: prefixo antigo volta; sem descarte de palavra vazia; 'ta' fora do lead de cartao; boa nao e saudacao; sem 'tenho guardado'; sem 'tenho limite'; sem 'tenho fatura'; sem 'devo pagar'; sem 'tenho parcela'; sem 'pago contas fixas'; sem 'falta meta'; sem 'guardei'; sem 'vida financeira'; sem 'tem saldo'; sem 'tenho disponivel'; sem 'tenho mes'; sem 'com conta'; hj/vc/manda/bora/sabe deixam de ser enchimento.
Sobreviveram 4 na 1a rodada, cobertos com testes novos e mortos na 2a: saudacao sem checar dia ("bom meu saldo" null); 'tenho grana' ("quanto tenho de grana?"); 'q' ("q tenho de saldo"); 'momento' ("quanto tenho no momento"). Sobreviventes finais: 0. Equivalentes: 0.
Obs: uma rodada anterior foi interrompida e deixou 'guardeiX' no codigo; detectado e restaurado antes do commit (tsc e testes verdes confirmam).

## Numeros (2026-11-25, conferido pelo revisor)
- tsc --noEmit: exit 0
- jest src/conversation src/telegram src/whatsapp --maxWorkers=2: 37 suites, 1717 testes verdes em UTC, America/Sao_Paulo e Asia/Tokyo
- suite inteira --maxWorkers=2 (TZ padrao): 95 suites, 2983 testes verdes
- spec novo 15x seguidas: 0 falhas
- graphify update .: ok

## NAO verificado
- Lint/prettier.
- Bot real (Telegram/WhatsApp) ponta a ponta; sem Docker (fora do escopo).
- Comportamento do servico para cardTerm loose sem cartao correspondente.
- Suite inteira so em 1 fuso.
- Handoff nao atualizado (sem merge na develop).

## Falta / recomendacao
1. Dono decide duvidas 1-8 (duvidas.md) e a nova acima.
2. Recomendo: aprovar e fazer merge --no-ff na develop; depois atualizar handoff.
3. Decidir se os prefixos antigos 'saldo'/'resumo' devem ficar exatos (nova fatia).
