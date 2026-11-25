# Contrato 12.0b: escrita natural com confirmacao de tom

Data: 2026-11-25. Estado: PROPOSTA para aprovacao do dono. Item 12. Decisoes do dono ate aqui: gente comum nao fala como robo; "caixinha" = sinonimo de meta/cofrinho; o bot confirma o que entendeu em mensagem com tom (ex.: "caiu 500 do freela" -> mensagem feliz).

## 1. Objetivo
O bot entende lancamentos e guardados escritos do jeito que as pessoas falam, e antes de gravar confirma o que entendeu com uma mensagem de tom adequado. Escrita continua SEMPRE rascunho + confirmacao + recibo; nada grava por inferencia.

## 2. Frases que passam a valer (todas exigem VALOR numerico na frase; sem valor = pergunta ou Selah, nunca grava)
| Tipo | Exemplos |
|---|---|
| Despesa | "gastei 50 no mercado", "paguei 80 de luz", "comprei 120 de racao", "foi 35 no uber", "saiu 200 do pix pro Joao", "50 de gasolina ontem", "torrei 90 no ifood" |
| Receita | "recebi 3000 de salario", "caiu 500 do freela", "entrou 200 de venda", "me pagaram 150", "ganhei 100 da vovo" |
| Guardar (meta/cofrinho; "caixinha" = sinonimo) | "guardei 200 na viagem", "coloquei 200 na minha caixinha", "juntei 100 pra moto", "depositei 50 no cofrinho", "separei 300 pra reserva da meta X" |
| Cartao | "gastei 50 no nubank", "passei 200 no credito", "50 no cartao do itau" (cartao pelo nome; sem nome, pergunta qual, como hoje) |
| Parcelado | "comprei um celular em 10x de 150", "parcelei a geladeira em 12x de 200" |
Valor aceito: "50", "50,90", "R$ 50", "50 reais", "50 conto(s)", "1.200". Numero por extenso e "k" ficam fora (decisao futura). Data: o que o parser de datas ja aceita (hoje, ontem, anteontem, dia N).
Verbos informais ("foi", "saiu", "caiu", "passei", "torrei", "separei") so valem com valor e sem "?". Pergunta, negacao e hipotese ("sera que gastei 50?", "nao gastei 50", "se eu gastar 50") NAO viram escrita.
"Caixinha" vale em guardar, listar, editar e apagar meta ("minhas caixinhas", "apagar caixinha viagem"). Sem nome de meta e com mais de uma: lista numerada para escolher (comportamento atual); com exatamente uma: usa essa e mostra no rascunho.

## 3. Confirmacao com tom (a mensagem do rascunho passa a ser o proprio "entendi")
- Tom por tipo, sem IA, textos fixos com 3 a 4 variantes escolhidas de forma deterministica (hash do messageId) para nao repetir sempre a mesma:
  - Receita: alegre ("Que boa! Entrou R$ 500,00 de freela 🎉").
  - Guardar: celebrando ("Boa! R$ 200,00 pra caixinha Viagem 💪").
  - Despesa: neutro e cuidadoso, nunca alegre ("Anotei: R$ 50,00 no mercado").
  - Parcelado: atento ("Entendi: celular em 10x de R$ 150,00 (total R$ 1.500,00)").
  - Apagar/editar: neutro.
- Sempre termina com a pergunta de confirmacao e os botoes/palavras de hoje (Confirmar/Cancelar). O texto mostra os dados que serao gravados (valor, descricao, data, categoria, cartao) para o usuario conferir.
- Depois de gravar: recibo curto no mesmo tom do tipo (receita comemora; despesa so confirma).
- Nunca usar tom alegre em despesa ou em descricao sensivel (saude, luto, divida, multa, cobranca, hospital, remedio, funeral): lista de palavras sensiveis -> tom neutro.
- Emoji: no maximo 1 por mensagem, so em receita e guardar.

## 4. Onde ensina
Ajuda, menu (12.1) e dicas passam a mostrar sempre a forma natural ("gastei 50 no mercado", "coloquei 200 na caixinha", "recebi 3000 de salario") e deixam de ensinar "50 mercado". "50 mercado" continua funcionando.

## 5. Implementacao e testes
- Matcher: tabela de verbos por tipo + exigencia de valor; negativos/hipoteses/perguntas; nada de logica nova de gravacao (reusa rascunhos existentes).
- Textos de tom em replies.ts (dados, sem if gigante), variante por hash testada; lista de palavras sensiveis.
- Testes: tabela de positivos por tipo, negativos (leitura, pergunta, negacao, hipotese, sem valor), regressao de tudo existente, tom por tipo, variante deterministica, sensivel => neutro; mutantes >= 18; 3 fusos; suite inteira; 15x; integracao real descartavel pelo canal Telegram/engine (rascunho -> confirmar -> 1 registro; cancelar nao grava; 100 confirmacoes concorrentes sem gravacao dupla).
- NAO verificavel aqui: percepcao real do tom pelo usuario (texto e gosto do dono; ajustar depois).

## 6. Fora do escopo
IA para interpretar frases livres (fica no Selah/fase 12.8); numero por extenso; audio; foto de nota (item 4).

## 7. Decisoes para o dono (padrao entre parenteses)
1. Tom alegre so em receita e guardar, despesa sempre neutra (padrao: sim).
2. Aceitar "conto(s)" como sinonimo de reais (padrao: sim).
3. Numero por extenso ("cinquenta") e "2k" ficam para depois (padrao: sim).
4. Voce quer revisar os textos finais das mensagens de tom antes do merge (padrao: sim, eu mostro todos).
