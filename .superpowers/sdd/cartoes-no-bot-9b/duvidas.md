# Duvidas de produto da 9b-1 (cartao no lancamento pela conversa)

Data: 2026-11-24. Registradas, nao decididas. O comportamento atual esta em resultado-9b1.md.

1. "credito" sem nenhum cartao ativo: hoje a frase fica na descricao ("mercado no credito") e a forma de pagamento segue null. Deve virar CREDIT sem cartao (conta no padrao) ou continuar assim?
2. Receita com "no <nome>" (ex.: "recebi 800 no nubank"): o cartao e ignorado, mas o trecho continua na descricao. Deve sair da descricao?
3. Escolha numerica da lista de cartoes aceita so 1 a 5 (mesma regra das categorias). Com 6 ou mais cartoes, a escolha e so pelo nome. Aceitavel?
4. "no credito <palavra>" com palavra que nao e cartao (ex.: "gastei 30 no credito padaria") responde "Nao achei cartao" e nao grava. A palavra solta deveria virar descricao em vez de erro?
5. Cartao com nome de loja (ex.: "Mercado Pago"): "no mercado pago" casa o cartao, como previsto no contrato. Limitacao aceita, ou o dono prefere nome composto obrigatorio?
