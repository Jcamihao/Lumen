# Duvidas de produto da 9b-1 (cartao no lancamento pela conversa)

Data: 2026-11-24. Registradas, nao decididas. Resolvidas pelo dono em 2026-11-24 ("recomendacoes"): "credito" sem cartao cadastrado e "no credito <palavra>" (ver resultado-9b1.md). Abertas:

1. Receita com "no <nome>" (ex.: "recebi 800 no nubank"): o cartao e ignorado, mas o trecho continua na descricao. Deve sair da descricao? (Dono: manter como esta.)
2. Escolha numerica da lista de cartoes aceita so 1 a 5 (mesma regra das categorias). Com 6 ou mais cartoes, a escolha e so pelo nome. (Dono: manter como esta.)
3. Cartao com nome de loja (ex.: "Mercado Pago"): "no mercado pago" casa o cartao, como previsto no contrato. (Dono: manter como esta.)

## Duvidas de produto da 9b-2 (leitura por cartao e meus cartoes)

Data: 2026-11-24. Registradas, nao decididas. Implementacao segue a regra escrita; o dono confirma ou muda.

4. "limite do X", "quanto sobrou no X", "fatura do X" (sem a palavra cartao): so viram leitura com nome EXATO de cartao do dono. Nome parcial ("quanto sobrou no nubank estourou") volta ao caminho de hoje (ajuda/IA), sem lista. Com a palavra cartao ("cartao nubank estourou") o nome e buscado como no 8d. Deve a forma sem a palavra casar parcial tambem?
5. Forma sem a palavra cartao com nome que casa mais de um cartao ("limite do vi", com Vivo e Vivo Pad): segue o caminho de hoje, sem lista. Deve listar os cartoes como a forma explicita faz?
6. "quanto gastei no credito" (sem nome): continua caminho de hoje (ajuda/IA), nao vira leitura do cartao padrao. Deve virar?

## Duvidas de produto da 9b-3 (criar e renomear cartao pela conversa)

Data: 2026-11-24. Registradas, nao decididas. Renomear segue a regra escrita; criar esta RECUSADO ate o dono decidir (ver item 7).

7. [RESOLVIDA 2026-11-24, opcao (a): o bot pergunta o fechamento; ver resultado-9b3b.md] CRIAR cartao pela conversa estava recusado. Motivo: a coluna `closingDay` do cartao e obrigatoria no banco (Int, sem padrao) e `CreditCardsService.create` exige o dia de fechamento; o brief diz "sem fechamento/vencimento por conversa". Nao inventei valor. Opcoes: (a) o bot pergunta o dia de fechamento (vencimento opcional) antes da confirmacao; (b) um dia padrao gravado sem perguntar (grava dado financeiro que o usuario nao escolheu); (c) manter a recusa "crie pela tela" (estado atual). Recomendacao: (a) ou (c) ate o dono escolher; (b) nao recomendo.
8. Renomear: o separador entre o cartao atual e o nome novo e o PRIMEIRO "para". Nome que tem "para" dentro ("Para Viagem") so funciona se o cartao atual nao tiver "para" antes do separador. Deve haver outra regra (ex.: aspas)?
9. Renomear: trocar so a caixa do nome ("Nubank" para "NUBANK") e permitido, como na API. Confirma?
10. Renomear: "renomear X" sem a palavra cartao vale quando X nao e meta, reserva, conta fixa ou parcelado (ex.: "renomear meta X para Y" segue fora). Confirma a lista de exclusoes?
