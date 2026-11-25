# Resultado da revisao 12.0b-1 (escrita natural)

Data: 2026-11-25. Revisor: Claude Sonnet 5.5 (agente unico, sem subagentes). Branch feat/bot-escrita-natural-12-0b.

## Veredito: GO (com 2 duvidas de produto abertas, ver abaixo)

## Achados e correcoes (commit afe9640 e commit de teste seguinte)
1. DEFEITO duvida 3 (corrigido): "?" bloqueava tambem verbos antigos ("gastei 50 mercado?"). Agora "?" so bloqueia as formas novas (matchNaturalWrite). Verbos antigos com "?" identicos a develop.
   Reproducao: matchIntent('gastei 50 mercado?') develop = create_expense; HEAD antigo = null; HEAD novo = create_expense.
2. Falso positivo corrigido: contagem apos o valor ("passei 200 vezes la", "passei 2 vezes no mercado", "entrou 2 vezes", "entrou 2 pessoas na fila", "foi 3 dias no hotel", "juntei 100 amigos", "guardei 2 caixas na garagem", "coloquei 200 litros de gasolina") agora nao vira rascunho (lista COUNT_WORDS).
3. Falso positivo corrigido: "coloquei/depositei/separei" so viram aporte se a frase tem caixinha, cofrinho ou meta ("coloquei 200 no bolso", "depositei 50 no banco", "separei 300 pra comida" saem). "guardei/juntei/poupei" seguem com destino livre.
4. Aporte exige palavra de ligacao logo apos o valor ("guardei 200 viagem" fora); "guardei 200 reais na viagem" passa a valer.
5. Parcelado aceita "reais" depois da parcela ("em 10x de 150 reais"); sobra qualquer outra recusa ("em 10x de 150 ontem" fora, "em 10x sem 150" fora).

## Diferencas matchIntent develop x HEAD
Corpus: 2507 frases (todas as strings de specs de conversation/telegram/whatsapp da develop com espaco ou digito + 100 frases proprias de brasileiro real, informais/sem acento/com "?").
- Regressoes de frase que ja casava na develop: 0 (nenhuma frase com resultado nao-nulo na develop mudou, exceto):
- Mudanca intencional (contrato: caixinha em editar/apagar): "apagar/excluir caixinha viagem" delete_transaction -> delete_goal; "editar caixinha viagem 6000" edit_transaction -> edit_goal.
- Demais 35 diferencas: develop null -> escrita natural nova/caixinha/parcelado (todas esperadas).

## Duvidas 1, 2 e 4 (mantidas)
"guardei 200"/"poupei 80" sem destino ficam fora; criar caixinha = criar meta (pede alvo); parcelado com data depois do valor fica fora.

## Riscos aceitos / duvidas de produto novas (registradas, nao decididas)
- "foi 50 no uber e 30 no ifood" vira rascunho de 50 com descricao "uber e 30 no ifood" (usuario ve e cancela). "foi 5 0 no mercado" = R$ 5. "me pagaram 35 mais 20" = R$ 35.
- "foi 0 no uber", "10x de 0", "0x" viram rascunho/erro do fluxo existente (valor zero recusado la), nada grava.
- "passei 200 la" vira despesa de 200 "la" (rascunho, pede categoria).
- "50 conto"/"50 contos" funcionam so como sufixo do valor; "50 contoso" fica descricao.
- "parcelado em 100x" gera total 100*parcela e o fluxo existente recusa fora de 2 a 60.
- Frase de conversa com verbo no inicio e valor ("foi 35 no uber foi 40 no ifood") vira rascunho do primeiro valor. Sempre exige confirmar.
- Hora local: o backend usa o dia do Brasil mesmo com TZ=Asia/Tokyo (hoje = dia de Sao Paulo). Comportamento existente.

## Integracao real (2026-11-25, conteineres rv13-pg Postgres 16 e rv13-redis Redis 7, portas 47432/56379, backend 53011, ENV inline, banco novo, migrate deploy)
Contas A, B, C pela API real. Resultado: todos OK.
- "foi 35 no uber" -> rascunho -> confirmar -> 1 Transaction EXPENSE uber 35.00 2026-11-25; confirmar de novo = 404, 1 registro.
- "caiu 500 do freela" -> INCOME freela 500.00. cancelar nao grava.
- 11 frases negativas (caiu a internet, o uber foi 35 ontem, foi 35?, passei 200 vezes la, entrou 2 vezes, me pagaram ontem 150 reais?, saiu 200 do pix?, sera que gastei 50?, nao gastei 50, coloquei 200 no bolso, foi uma semana boa): sem rascunho, nada gravado.
- "coloquei 200 na minha caixinha": 0 metas = "Voce nao tem metas ativas."; 1 meta = rascunho -> aporte, currentAmount 200.00; 2 metas = lista "Qual meta? 1) Viagem 2) Moto."; "juntei 100 pra moto" -> aporte 100.00 na Moto.
- "comprei um celular em 10x de 150" -> pede primeiro vencimento -> InstallmentPurchase total 1500.00, parcela 150.00, 10 parcelas, 1 gerada (as demais pelo worker, desligado aqui).
- Cartao: "gastei 50 no nubank" e "passei 200 no credito" -> rascunho com Cartao Nubank (pede descricao, pois a frase nao tem; comportamento existente) -> gravados com cardId.
- 100 confirmacoes concorrentes do mesmo rascunho: 25x HTTP 200 (mesmo recibo) + 75x 404; delta = 1 registro; 0 respostas 5xx.
- Isolamento: B so ve o proprio lancamento, C ve 0 e nao confirma rascunho de B (404); sessao de C vazia.
- Falha de banco (docker pause so no rv13-pg durante a confirmacao): a requisicao ficou pendurada (cliente desistiu em 8 s, sem resposta); apos unpause o registro existia (1) e reconfirmar = 404; nenhuma duplicata. Resultado visto pelo cliente: DESCONHECIDO, depois persistiu (nao repetir, conferir a tela). Nao ha timeout de servidor na confirmacao (risco registrado, fora do escopo).
- Datas em TZ=UTC, Asia/Tokyo, America/Sao_Paulo (backend reiniciado em cada): "50 de gasolina ontem" 2026-11-24, "caiu 500 do freela anteontem" 2026-11-23, "foi 35 no uber" 2026-11-25 nos tres.
- Limpeza: conteineres rv13-* removidos (--rm), backend encerrado pelo meu PID, portas 47432/56379/53011 sem listener. Conteineres do dono nao foram tocados (orquestrador-ia-* constam Exited por acao externa; detect-objects, wa-akg-db seguem Up; lumen-* seguem Exited como antes). O .env da raiz nao existe no worktree; nenhum acesso ao 5433.

## Mutantes (27 injetados por mim, alvo write-natural.ts, intent.matcher.ts, amount.parser.ts, goal.parser.ts)
- Mortos: 25 na primeira rodada. Sobreviventes: 2 ("de" do parcelado e descricao vazia do parcelado); cobertos com 3 negativos novos e remutados: mortos. Total 27/27 mortos. Equivalentes: nenhum.
- Lista: limite de caracteres e palavras, "?" natural, verbo foi, me pagaram, poupei, filler, contagem, palavra-chave de coloquei, depositei, conector do destino, destino so conectores, total do parcelado (x vs +), centavos, sobra apos parcela, regex Nx, "de", descricao vazia, parcelado removido, valor obrigatorio, artigos, chamada do natural, criar/listar/editar-apagar caixinha, conto, caixinha no aporte.

## Numeros (2026-11-25, conferidos por Claude Sonnet 5.5)
- tsc --noEmit: EXIT 0.
- src/conversation, src/telegram, src/whatsapp (42 suites): 1960 verdes em UTC, America/Sao_Paulo e Asia/Tokyo.
- Suite inteira TZ=UTC --maxWorkers=2: 100 suites, 3226 verdes.
- Testes novos (write-natural, amount, goal) 15 execucoes: 191 verdes em todas.
- graphify update .: ok.

## NAO verificado
- Canais Telegram e WhatsApp reais (so o endpoint APP /conversation).
- Parcelas 2 a 10 geradas pelo worker (Redis/worker desligados no backend de teste).
- Percepcao do tom (12.0b-2).
- Timeout de confirmacao com banco travado (so observado).
- Corpus de 100 frases proprias nao foi todo promovido a teste: so as obvias/seguras entraram; as arriscadas ficaram na lista de riscos acima.
