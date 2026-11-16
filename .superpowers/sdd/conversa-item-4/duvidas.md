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

# Dúvidas de contrato: revisão 4a-2 (sonnet)

1. O contrato fixa prazo de 30 s só para OCR. A leitura de texto de PDF (`readPdfText`) não tem prazo: um PDF hostil de até 10 MB e 3 páginas pode ocupar CPU do processo. Decisão do dono ou da 4a-3: incluir prazo para PDF (por exemplo 10 s) ou aceitar o risco.
2. Duas leituras simultâneas de imagens de 24 MP chegaram a 1,1 GB de RSS. O teto de 25 MP do contrato permite isso; dimensionar o container ou reduzir o teto.

# Dúvidas de contrato: brief 4b (tela de nota)

1. Aviso de duplicata: o brief fala em "trocar o aviso atual", mas a tela não tinha aviso de `possibleDuplicate`. A caixa foi criada do zero com classes existentes (`proto-note`, `proto-tag`, `proto-inline-title`), sem cor nova.
2. Divergência após edição: o brief pede X = `totalMismatch.itemsSum` e Y = `totalMismatch.total`. Implementado com os valores locais (soma dos itens editados e total editado). Iguais aos do servidor até o usuário editar. Após edição, mostrar o número do servidor seria enganoso.
3. Classe de aviso: não existe `proto-note` com tom. O aviso usa `proto-note` + `proto-tag[data-tone='warning']`.
4. Texto de "Leitura Selah": o parágrafo do bloco foi trocado para "Leitura do perfil desse gasto a partir da nota." (o brief pedia só o título).
5. Mensagem padrão de erro do preview: "Não consegui ler esta nota. Tente outra foto ou lance o gasto pelo chat."
6. Caixa de duplicata: confirmar o commit com a caixa visível envia `acknowledgeDuplicate: true`. Sem caixa, a chave não vai no payload.
