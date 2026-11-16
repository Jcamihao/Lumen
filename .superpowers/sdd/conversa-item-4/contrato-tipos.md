# Contrato de tipos do item 4 (importar nota fiscal sem IA)

Data: 2026-11-16. Fonte de regras: `docs/superpowers/specs/2026-11-16-conversa-contrato-item-4.md` (seções 6, 7, 10 e 13). Este arquivo fixa nomes, assinaturas e textos. Dúvida ou mudança de contrato: registrar em `duvidas.md` desta pasta e avisar o agente principal; não decidir sozinho.

## Parte 4a-1: parser puro (`backend/src/imports/receipt-text.parser.ts`)

Sem biblioteca nova, sem banco, sem rede, sem relógio global (a data de "hoje" entra por parâmetro). Todas as datas são criadas com `Date.UTC` (data pura à meia-noite UTC). Tudo deve dar o mesmo resultado em `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`.

```ts
export type ReceiptTextItem = {
  description: string;          // aparada, espaços colapsados, até 200 caracteres
  quantity: number;             // até 3 casas decimais, maior que 0
  unit: string | null;          // 'UN' | 'KG' | 'L' | 'CX' | 'PC' | 'G' ... em maiúsculas, ou null
  unitPrice: number | null;
  totalPrice: number;           // maior que 0
  lineConsistent: boolean;      // false quando quantidade x unitário difere do total da linha por mais de R$ 0,01
};

export type ReceiptTotalMismatch = { itemsSum: number; total: number; difference: number };

export type ParsedAccessKey = {
  key: string;                  // 44 dígitos, DV válido
  ufCode: string;               // 2 dígitos
  year: number;                 // 2000 a 2099
  month: number;                // 1 a 12
  cnpj: string;                 // 14 dígitos
  model: string;                // 2 dígitos ('65' = NFC-e)
  series: string;               // 3 dígitos
  number: string;               // 9 dígitos, com zeros à esquerda
};

export type ParsedReceiptText = {
  merchantName: string | null;
  cnpj: string | null;                  // 14 dígitos, DV válido
  cnpjSource: 'KEY' | 'TEXT' | null;
  accessKey: string | null;             // só chave de 44 dígitos com DV válido
  accessKeyValid: boolean;              // true quando accessKey != null
  documentNumber: string | null;        // número da nota sem zeros à esquerda (da chave quando válida; senão do texto)
  purchaseDate: Date | null;
  totalAmount: number | null;
  items: ReceiptTextItem[];
  itemsSum: number | null;              // soma dos totalPrice, em centavos exatos; null sem itens
  totalMismatch: ReceiptTotalMismatch | null;
  warnings: string[];                   // textos em português da lista fixa abaixo
  rawTextRedacted: string;              // texto sem CPF, máximo 500 caracteres
};

export function parseReceiptText(
  text: string,
  options: { today: Date; qrAccessKey?: string | null },
): ParsedReceiptText;
```

Funções auxiliares exportadas (cada uma com testes próprios):

| Função | Regra |
|---|---|
| `parseBrMoney(raw: string): number \| null` | Aceita `32,90`, `1.234,56`, `R$ 32,90`, `0,5` NÃO (exige 2 casas). Ponto só como milhar (`\d{1,3}(\.\d{3})+,\d{2}`). `32.90` e `1,234.56` são ambíguos: `null`. Zero, negativo ou acima de 1.000.000,00: `null`. Arredonda para 2 casas sem erro de ponto flutuante. |
| `parseBrQuantity(raw: string): number \| null` | `1`, `2`, `0,350`, `1,000`. Vírgula como decimal, até 3 casas. Zero ou negativo: `null`. |
| `parseBrDate(raw: string, today: Date): Date \| null` | `dd/mm/aaaa` e `dd/mm/aa` (ano de 2 dígitos vira 2000 a 2099). Data de calendário inexistente (31/02): `null`. Anterior a 01/01/2000 ou posterior a `today`: `null`. Resultado em `Date.UTC`. |
| `fixNumericOcr(raw: string): string` | `O`/`o` para 0, `I`/`l`/`\|` para 1, `S` para 5, `B` para 8. Só para campos numéricos (chave, CNPJ). |
| `isValidAccessKeyDv(key: string): boolean` | 44 dígitos e DV módulo 11 (pesos 2 a 9 da direita para a esquerda; resto 0 ou 1 vira 0). Recusa 44 dígitos todos iguais (a conta de zeros "fecha" por acaso). |
| `normalizeAccessKey(raw: string): string \| null` | Remove espaços e quebras, aplica `fixNumericOcr`, exige 44 dígitos e DV válido; senão `null`. |
| `decodeAccessKey(key: string): ParsedAccessKey \| null` | `null` se a chave for inválida. Posições: UF 0-1, AAMM 2-5, CNPJ 6-19, modelo 20-21, série 22-24, número 25-33. Mês fora de 1 a 12: `null`. |
| `isValidCnpj(cnpj: string): boolean` | 14 dígitos, dois DVs, recusa sequência repetida (`00000000000000`). |
| `redactCpf(text: string): string` | Remove CPF com pontuação (`000.000.000-00`), 11 dígitos soltos depois da palavra `CPF` e tudo que seguir `CPF` na mesma linha por até 30 caracteres, trocando por `CPF removido`. Não pode alterar chave de 44 dígitos nem CNPJ. |
| `sanitizeQrUrl(raw: string): string \| null` | Recebe o texto do QR. Se for URL `http(s)`, devolve só `protocolo://host/caminho` mais `?p=<chave de 44 dígitos>` quando houver; sem `p` de 44 dígitos devolve só `protocolo://host/caminho`. Qualquer outra coisa: `null`. Nunca devolve parâmetros além de `p`. |
| `extractAccessKeyFromQr(raw: string): string \| null` | Procura `p=` seguido de 44 dígitos (aceita `p=<chave>\|2\|1...`). Valida com `normalizeAccessKey`. |

### Regras de `parseReceiptText`

1. **Chave:** procurar depois da última ocorrência de `CHAVE DE ACESSO` (próximas 3 linhas, cortando em `CONSUMIDOR`); se não achar, procurar qualquer sequência de 44 dígitos (aceita espaços em grupos de 4) no texto. Só vale com DV válido. `options.qrAccessKey` válida vence a do texto. Se as duas forem válidas e diferentes, usa a do QR e acrescenta o aviso `W_KEY_CONFLICT`.
2. **CNPJ:** com chave válida, vem da chave (`cnpjSource = 'KEY'`). Sem chave, procurar `NN.NNN.NNN/NNNN-NN` no texto (aplicando `fixNumericOcr` só nesse trecho); só vale com DV válido, `cnpjSource = 'TEXT'`. Sem DV válido, `null` e aviso `W_CNPJ_INVALID` se algum candidato apareceu.
3. **Número do documento:** da chave quando válida (sem zeros à esquerda); senão `NFC-e n. 123456` / `Nº 123456` do texto; senão `null`.
4. **Data:** primeira data de linha que também tenha horário `hh:mm`; senão a primeira data do texto. Inválida: `purchaseDate = null` e `W_DATE_INVALID`. Se a chave for válida e o mês/ano da data diferirem do AAMM da chave: manter a data e acrescentar `W_DATE_KEY_MISMATCH`.
5. **Itens:** aceitar três formatos de linha, pela ordem.
   - A, uma linha: `[código 1-14 dígitos] DESCRIÇÃO QTD UN VLUNIT VLITEM` (exemplo `001 ARROZ TIPO 1 5KG 1 UN 24,90 24,90`).
   - B, uma linha com `x`: `[código] DESCRIÇÃO QTD UN x VLUNIT VLITEM`.
   - C, duas linhas: descrição em uma linha e `QTD UN x VLUNIT VLITEM` na seguinte.
   A descrição precisa ter pelo menos 2 letras. Linha que não casa é ignorada sem erro. `lineConsistent` e o aviso `W_ITEM_LINE(n)` quando a conta não fecha (tolerância: diferença em centavos maior que 1). Nunca inventar item.
6. **Total:** candidatos nas linhas com `VALOR TOTAL`, `TOTAL R$`, `VALOR A PAGAR`, `TOTAL A PAGAR` ou `TOTAL` sozinho; **ignorar** linhas com `QTD`, `ITENS`, `DESCONTO`, `TROCO`, `TRIBUTOS`, `SUBTOTAL`. Vários candidatos: escolher o que for igual à soma dos itens; se nenhum for, o maior e acrescentar `W_TOTAL_AMBIGUOUS`. Nenhum candidato: `totalAmount = null`.
7. **Soma:** `itemsSum` em centavos inteiros. `totalMismatch` preenchido só quando há total, há itens e a diferença absoluta em centavos é **maior que 1** (R$ 0,01 não é divergência; R$ 0,02 é). `difference = total - itemsSum` com sinal. Acrescentar `W_TOTAL_MISMATCH`.
8. **Sem itens:** `items = []`, `itemsSum = null`, aviso `W_NO_ITEMS`.
9. **Privacidade:** `rawTextRedacted = redactCpf(text)` com colapso de linhas vazias repetidas e corte em 500 caracteres. O CPF nunca aparece em nenhum campo do resultado.
10. **Nunca lança por texto estranho.** Texto vazio, binário ou gigante (acima de 200.000 caracteres: truncar antes de processar) devolve o resultado vazio com avisos. Sem expressão regular com risco de backtracking catastrófico: teste com 100.000 caracteres de `9` e de `-` em menos de 500 ms.

### Textos de aviso (fixos, português)

```ts
export const RECEIPT_WARNINGS = {
  W_KEY_CONFLICT: 'A chave do QR Code é diferente da chave impressa. Usei a do QR Code.',
  W_CNPJ_INVALID: 'O CNPJ lido não passou na conferência. Confira o estabelecimento.',
  W_DATE_INVALID: 'Não consegui ler a data da compra. Informe a data.',
  W_DATE_KEY_MISMATCH: 'O mês da data lida é diferente do mês da chave de acesso. Confira a data.',
  W_TOTAL_AMBIGUOUS: 'Encontrei mais de um valor total e nenhum bate com a soma dos itens. Confira o total.',
  W_TOTAL_MISMATCH: 'A soma dos itens é diferente do total da nota. Confira cada linha.',
  W_NO_ITEMS: 'Não consegui ler os itens da nota. Confira o total.',
  W_NO_TOTAL: 'Não consegui ler o total da nota.',
} as const;
// W_ITEM_LINE: função (n: number) => `Item ${n}: quantidade vezes preço não fecha com o valor da linha. Confira.`
```

Aviso `W_NO_TOTAL` entra quando `totalAmount` for `null`. Ordem dos avisos: a da lista acima; sem repetição.

## Parte 4a-2: extrator e integração (detalhar depois da revisão da 4a-1)

Esboço, sujeito a revisão pelo agente principal antes do brief da 4a-2:

- `ReceiptExtractorService.extract({ buffer, mimeType, fileName, today })` devolve `ParsedReceiptText & { extraction: { method: 'QR' | 'PDF_TEXT' | 'OCR'; ocrConfidence: number | null; warnings: string[] }; qrCodeText: string | null }`.
- Erros tipados: `ReceiptUnreadableError` (422 `RECEIPT_UNREADABLE`), `ReceiptBusyError` (429 `RECEIPT_BUSY`), recusa de HEIC e de PDF sem texto (400 com as mensagens da seção 13 do contrato).
- Migration aditiva `ReceiptScan.accessKey String?` com índice `(userId, accessKey)`; commit com `acknowledgeDuplicate` e 409 `RECEIPT_DUPLICATE_UNCONFIRMED`.
- Dependências, versões exatas: `tesseract.js` 7.0.0, `@tesseract.js-data/por` 1.0.0, `jsqr` 1.4.0, `sharp` 0.35.5, `pdfjs-dist` 4.10.38.
