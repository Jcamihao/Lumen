# Duvidas de produto - bot perguntas naturais

Nao decididas. Dono confirma.

1. Prefixo "quanto tenho" ja existe no matcher antigo (startsWith -> balance). Por isso estas frases caem em SALDO hoje, nao no Selah, e continuam assim (nao mexi em intent atual):
   - "quanto tenho guardado" / "quanto tenho de reserva" (deveriam ser reservas)
   - "quanto tenho de limite" (deveria ser cartao)
   - "quanto tenho de fatura" (deveria ser cartao)
   - "quanto tenho que guardar por mes para comprar um carro de 50 mil" (deveria ir ao Selah)
   Sugestao: trocar o prefixo "quanto tenho" por "quanto tenho" + sem complemento. Decida.
2. "quanto sobrou no Nubank?" ja e null (teste existente em intent.matcher.credit-limit.spec.ts). O brief dizia que casava; mantive null. Regra: "?" com nome de cartao so vale se a frase comeca com "como" ou "qual".
3. "quanto devo no Nubank?" (com "?") fica null pela mesma regra. Sem "?" casa.
4. "quanto gastei hoje" devolve total do mes (spend_total). "hoje" e tratado como enchimento. Confirme que e isso mesmo.
5. "quanto devo no <cartao>" virou leitura de FATURA do cartao. Confirme.
6. "quanto gastei no total" casa spend_total. Para isso, leitura por cartao (loose) nao aceita mais palavra de leitura como nome ("total", "mes"...). Efeito colateral aceito; "quanto gastei no mercado" continua cardTerm loose.
7. "parcelado" (singular) e "conta fixa" (sem verbo) continuam fora: teste existente manda null.
8. "quanto sobrou" e "quanto sobrou esse mes" viraram SALDO (contrato do brief).
