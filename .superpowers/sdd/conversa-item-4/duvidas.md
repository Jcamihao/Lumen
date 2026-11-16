# Dúvidas de contrato: parser 4a-1

Registradas pelo subagente haiku ao implementar `receipt-text.parser.ts`. Decisão tomada no código, a confirmar pelo agente principal.

1. `merchantName`: o contrato não diz como extrair. Usei heurística: primeira linha entre as 15 primeiras que tem só letras/dígitos/pontuação, pelo menos 4 letras e não contém palavras de rótulo (CNPJ, CPF, NFC, TOTAL, RUA etc.).
2. Data ausente: o contrato só fala de data inválida. Quando não há nenhuma data no texto, `purchaseDate = null` e entra `W_DATE_INVALID`.
3. `W_ITEM_LINE(n)`: `n` é a posição do item na lista de itens lidos (1, 2, 3...), não o número da linha no texto.
4. Ordem dos avisos: os de linha de item entram logo depois de `W_TOTAL_MISMATCH` (o contrato não fixa a posição).
5. `W_ITEM_LINE` ficou dentro do objeto `RECEIPT_WARNINGS` como função (o contrato a mostra como comentário).
6. `redactCpf`: a regra "CPF + até 30 caracteres na mesma linha" também apaga o que vier depois na mesma linha (ex.: `CONSUMIDOR`). Segue o contrato literalmente. Efeito colateral: se uma chave de 44 dígitos estiver na mesma linha de um CPF, pode ser apagada parcialmente.
7. Privacidade: o parser trabalha sobre o texto original; o texto sem CPF só é aplicado a `rawTextRedacted`, ao nome do estabelecimento e às descrições de item.
8. Funções auxiliares exportadas: a tabela tem 11 linhas (o brief fala em 9). Exportei as 11.
