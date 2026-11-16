# Layouts de cupom que o parser 4a-1 não lê

Data: 2026-11-16. Origem: revisão 4a-1 (sonnet). Textos 100% sintéticos, escritos de memória no estilo de DANFE NFC-e e de cupom SAT. Nenhuma nota real foi usada. Cada linha abaixo está coberta por um teste em `backend/src/imports/receipt-text.parser.spec.ts` (grupo "layouts sinteticos de cupom").

Resumo: de 9 layouts sintéticos testados, 3 foram lidos certo e sem aviso (NFC-e SP com chave em duas linhas, itens em duas linhas, total pago/troco/tributos ignorados), 2 foram lidos certo com divergência sinalizada (desconto por item e SAT com desconto geral) e 4 falham de leitura (tabela abaixo). **Nenhum erro silencioso** restou depois das correções: todo layout não lido acaba em aviso (`W_NO_ITEMS` ou `W_NO_TOTAL`) ou em divergência sinalizada (`W_TOTAL_MISMATCH`).

Isto serve de insumo para o portão do ajuste 9 (notas reais): se estes padrões aparecerem nas notas reais do dono, a taxa de acerto cai e o desenho muda.

## Falhas de leitura (item ou total não reconhecido, com aviso)

| # | Linha (sintética) | Motivo | Resultado hoje |
|---|---|---|---|
| 1 | `Codigo: 123 Descricao: ARROZ 5KG Qtde: 1 UN: UN Vl Unit: 24,90 Vl Total: 24,90` | Formato rotulado numa linha só (estilo de algumas SEFAZ). Os três formatos A, B e C do contrato não casam. | `items = []`, `W_NO_ITEMS`. Total lido do rótulo `Total R$`. |
| 2 | `001 ARROZ 5KG 1UN 24,90 24,90` | Unidade colada na quantidade (`1UN`); o parser exige espaço entre quantidade e unidade. Comum em OCR que perde o espaço. | `items = []`, `W_NO_ITEMS`. |
| 3 | `002 PRODUTO LONGO 12345678 UN 3 5,00 15,00` | Ordem das colunas diferente (unidade, quantidade, unitário, total) e código longo antes da unidade. | `items = []`, `W_NO_ITEMS`. |
| 4 | `VALOR TOTAL R$` numa linha e `24,90` na linha seguinte | Total quebrado em duas linhas (acontece em OCR de papel estreito). | `totalAmount = null`, `W_NO_TOTAL`. |

Outros padrões que o parser também não lê, sem teste próprio (previstos pela leitura do código):

- Item com valor de desconto na mesma linha depois do total (`ARROZ 1 UN 24,90 24,90 -2,00`): a linha não termina em dois valores, então não casa.
- Quantidade com mais de 9 dígitos antes da vírgula, ou com mais de 3 casas.
- Unidade com mais de 4 letras ou com dígitos (`CX12`, `PACOTE`).
- Descrição sem 2 letras (`7891000100103 5 UN 24,90 24,90`).
- Chave de acesso impressa com traços ou pontos entre os grupos (só espaço e quebra de linha são aceitos).
- Valores com ponto decimal (`24.90`): recusados de propósito (ambíguos com milhar).

## Leitura certa, mas com divergência sinalizada (não é erro silencioso)

| Layout | O que acontece |
|---|---|
| Desconto por item em linha separada (`Desconto item -2,00`) | Itens lidos com o valor bruto; o total da nota já tem o desconto. Soma dos itens maior que o total: `totalMismatch` e `W_TOTAL_MISMATCH`. |
| Subtotal, desconto geral e total no estilo SAT | Idem: `totalAmount = 35,00` (certo), `itemsSum = 37,44`, `W_TOTAL_MISMATCH`. |

## Resolvido pelo agente principal em 2026-11-16: bruto contra a pagar

O caso abaixo agora gera o aviso `W_TOTAL_MULTIPLE` (o parser continua devolvendo o candidato que bate com a soma dos itens, mas avisa que existe outro total). Teste: "valor bruto bate com os itens e ha outro total". A preferência por "valor a pagar" fica para o portão com notas reais. Texto original do risco:

## Risco a decidir com o dono (contrato manda, mas pode surpreender)

Nota com desconto geral que imprime `Valor total R$ 49,01` (bruto) e `Valor a pagar R$ 45,00` (líquido). A regra 6 do contrato escolhe o candidato que **bate com a soma dos itens**, então o parser devolve 49,01 **sem aviso**, e o gasto lançado ficaria R$ 4,01 acima do que a pessoa pagou. O parser segue o contrato; a decisão (preferir "valor a pagar", ou avisar quando os candidatos divergem mesmo havendo um que bate com a soma) é do dono e deve ser testada no portão com notas reais.
