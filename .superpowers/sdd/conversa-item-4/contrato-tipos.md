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
  W_TOTAL_MULTIPLE: 'Encontrei mais de um valor total na nota (por exemplo, valor bruto e valor a pagar). Confira quanto você pagou.', // acrescentado após a revisão da 4a-1: um candidato bate com a soma, mas existe outro
  // Linhas ignoradas no total (revisão 4a-1): QTD, ITENS, DESCONTO, TROCO, TRIBUTOS, SUBTOTAL, PAGO, RECEBIDO, IMPOSTO, ACRÉSCIMO.
  W_TOTAL_MISMATCH: 'A soma dos itens é diferente do total da nota. Confira cada linha.',
  W_NO_ITEMS: 'Não consegui ler os itens da nota. Confira o total.',
  W_NO_TOTAL: 'Não consegui ler o total da nota.',
} as const;
// W_ITEM_LINE: função (n: number) => `Item ${n}: quantidade vezes preço não fecha com o valor da linha. Confira.`
```

Aviso `W_NO_TOTAL` entra quando `totalAmount` for `null`. Ordem dos avisos: a da lista acima; sem repetição.

## Parte 4a-2: extrator e integração

Dependências já instaladas e commitadas pelo agente principal (versões exatas, sem `^`): `tesseract.js` 7.0.0, `@tesseract.js-data/por` 1.0.0, `jsqr` 1.4.0, `sharp` 0.35.5, `pdfjs-dist` 4.10.38. Verificado: `npm ci --ignore-scripts` limpo instala todas e `sharp`, `jsqr` e `tesseract.js` carregam em Node 20. Não adicione outra dependência.

### Arquivos (todos em `backend/src/imports/` salvo indicação)

| Arquivo | O que tem |
|---|---|
| `receipt-extractor.types.ts` | tipos e erros abaixo |
| `receipt-readers.ts` | leitores finos: `decodeQr`, `readPdfText`, `OcrPool` |
| `receipt-extractor.service.ts` | `ReceiptExtractorService` (Nest `@Injectable`), orquestra os leitores e o parser da 4a-1 |
| `imports.service.ts` | troca da fonte do `previewReceiptImport`; checagem de duplicata no `commitReceiptImport` |
| `imports.module.ts` | registra `ReceiptExtractorService` e `OcrPool` |
| `imports.controller.ts` | só textos do Swagger (sem "por IA") |
| `dto/commit-receipt-import.dto.ts` | campo `acknowledgeDuplicate` |
| `backend/prisma/schema.prisma` e `backend/prisma/migrations/20261116120000_receipt_scan_access_key/migration.sql` | coluna e índice |
| `backend/test/receipt-extractor.smoke.ts` | script manual (fora do jest) que lê todas as fixtures reais e imprime o resultado |

Fixtures sintéticas já commitadas em `backend/test/fixtures/receipts/` (`truth.json` tem o gabarito: estabelecimento, CNPJ, data `dd/mm/aaaa`, itens, total, chave): `nota-n1.png` (QR + texto limpo), `nota-n1-jpeg.jpg` (JPEG de baixa qualidade, o QR pode não ser lido), `nota-n2-texto.pdf` (PDF com camada de texto), `nota-n1-digitalizada.pdf` (PDF só com imagem).

### Tipos (`receipt-extractor.types.ts`)

```ts
import type { ParsedReceiptText } from './receipt-text.parser';

export type ReceiptExtractionMethod = 'PDF_TEXT' | 'OCR';

export type ReceiptExtraction = ParsedReceiptText & {
  extraction: {
    method: ReceiptExtractionMethod;   // imagem = 'OCR' (o QR só complementa a chave); PDF com texto = 'PDF_TEXT'
    ocrConfidence: number | null;      // 0 a 1 (confiança do tesseract dividida por 100), null em PDF_TEXT
    warnings: string[];                // = parsed.warnings (mesmos textos do parser) + avisos de extração abaixo
    qrDetected: boolean;               // achou QR legível na imagem
    secondPass: boolean;               // usou a segunda passada com pré-processamento
  };
  qrCodeText: string | null;           // saída de sanitizeQrUrl, ou null
};

export type ReceiptExtractInput = { buffer: Buffer; mimeType: string; fileName: string; today: Date };

// Erros. Todos estendem HttpException do Nest com corpo { statusCode, code, message }.
export class ReceiptUnreadableError  // 422, code 'RECEIPT_UNREADABLE'
export class ReceiptBusyError        // 429, code 'RECEIPT_BUSY',  message 'Muitas leituras agora, tente em instantes.'
// Recusas com BadRequestException (400, sem code): HEIC e PDF digitalizado (mensagens da seção 13 do contrato do item).
```

Mensagem de `ReceiptUnreadableError` (fixa): `Não consegui ler esta nota. Lance o gasto pelo chat ("50 mercado") ou pela tela de Finanças.` Para estouro de tempo do OCR use a mesma classe com a mensagem: `A leitura demorou demais. Tente uma foto mais nítida, ou lance o gasto pelo chat ("50 mercado") ou pela tela de Finanças.`

### Fluxo de `ReceiptExtractorService.extract`

1. **Vaga:** contador de leituras em andamento por processo. Se já houver 2, lança `ReceiptBusyError` **sem esperar** (nada de fila). A vaga é tomada no início e liberada em `finally`, inclusive em erro e em timeout.
2. **Tipo:** `mimeType` vem de `sniffMime` (já validado pelo `ensureReceiptFile`). `image/heic` (HEIC/HEIF) → `BadRequestException('Formato HEIC não é lido. Envie a foto em JPG ou PNG, ou tire um print da nota.')`.
3. **PDF (`application/pdf`):** `readPdfText` (no máximo 3 páginas). Se o texto tiver menos de 40 caracteres entre letras e dígitos → `BadRequestException('Este PDF é uma imagem digitalizada e não pode ser lido. Envie a foto da nota em JPG ou PNG.')`. Senão `parseReceiptText(text, { today })`, `method = 'PDF_TEXT'`, `qrDetected = false`, `qrCodeText = null`. PDF protegido por senha, corrompido ou que faça o `pdfjs` lançar → `ReceiptUnreadableError`.
4. **Imagem:**
   1. `sharp(buffer, { limitInputPixels: 25_000_000 }).metadata()`; largura × altura acima de 25 milhões de pixels → `BadRequestException('Imagem muito grande. Envie uma foto com até 25 megapixels.')`. Arquivo que o `sharp` não abre → `BadRequestException('Não consegui abrir esta imagem. Envie a foto em JPG ou PNG.')`. Sempre `limitInputPixels` em toda chamada do `sharp`.
   2. **Orientação:** aplicar `.rotate()` sem argumento (respeita EXIF; foto de celular vem deitada) e converter para PNG sem outra alteração. Essa é a imagem da primeira passada.
   3. **QR:** `decodeQr` com teto total de 800 ms (tentativas em largura original, 900, 1400 e 600; antes de cada tentativa conferir o tempo gasto e parar se passou de 800 ms). `extractAccessKeyFromQr(raw)` vira `qrAccessKey`; `qrCodeText = sanitizeQrUrl(raw)`; `qrDetected = raw != null`.
   4. **OCR, 1ª passada:** `OcrPool` com `tessedit_pageseg_mode: '6'` e `preserve_interword_spaces: '1'`, idioma `por`, dado local (ver abaixo). `parseReceiptText(texto, { today, qrAccessKey })`.
   5. **2ª passada** só se a 1ª tiver `totalAmount === null` ou `totalMismatch !== null`: imagem em tons de cinza, `normalise()`, largura 1400 px (`resize({ width: 1400 })`), `sharpen()`, PNG; novo OCR e novo parse. Escolher o resultado com esta pontuação, o maior vence, empate fica com a 1ª: `(total != null ? 4 : 0) + (itens > 0 ? 2 : 0) + (totalMismatch == null ? 2 : 0) - warnings.length * 0.1`. `secondPass = true` se a 2ª foi usada.
   6. **Prazo:** o OCR todo (as duas passadas) tem 30 s. Estourou → terminar o worker, descartá-lo do pool e lançar o `ReceiptUnreadableError` de tempo.
5. **Ilegível:** depois de qualquer leitura, `totalAmount === null` (mesmo havendo itens: o total é obrigatório no banco e não se inventa) → `ReceiptUnreadableError`. Total lido e sem itens é aceito (aviso `W_NO_ITEMS` do parser).
6. **Nada sai do processo:** sem chamada de rede, sem arquivo temporário, sem log do texto lido. Pode logar (nível `log`) só: método, `secondPass`, tempo em ms, número de itens, quantidade de avisos.

### `receipt-readers.ts`

- `decodeQr(png: Buffer, deadlineMs = 800): Promise<string | null>`: `sharp(...).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })` e `jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: 'attemptBoth' })`.
- `readPdfText(buffer: Buffer, importer?): Promise<string>`: `pdfjs-dist/legacy/build/pdf.mjs` é ESM e o backend é CommonJS; o TypeScript trocaria `import()` por `require()` e quebraria. Use `const dynamicImport = new Function('specifier', 'return import(specifier)')` (comentar o motivo). `getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true })`, até 3 páginas, `getTextContent()`, juntar `item.str` e quebrar linha onde `item.hasEOL`; páginas separadas por `\n`. Parâmetro `importer` opcional para teste. Liberar o documento (`pdf.destroy()`) em `finally`.
- `OcrPool` (`@Injectable`, implementa `OnModuleDestroy`): cria workers sob demanda (no máximo 2), cada um com `createWorker('por', 1, { langPath, gzip: true, ... })`, onde `langPath = join(dirname(require.resolve('@tesseract.js-data/por/package.json')), '4.0.0_best_int')`. **Não pode haver download em tempo de execução nem cache em disco fora de `os.tmpdir()`**: confirme as opções da versão 7.0.0 (no spike usou-se `cachePath`; prefira desligar o cache se a opção existir). `recognize(png: Buffer, timeoutMs): Promise<{ text: string; confidence: number }>`; no timeout, `worker.terminate()` e remover do pool. Sempre limpar o `setTimeout` (o jest acusa handle aberto). `onModuleDestroy` termina todos os workers.
- Imports no TypeScript do projeto (sem `esModuleInterop`): `import sharp = require('sharp')`; `jsqr` com `const jsQR = require('jsqr') as (...)=>...` e tipo mínimo escrito por você; `import { createWorker } from 'tesseract.js'`.

### Mudanças em `ImportsService`

- Construtor ganha `private readonly receiptExtractor: ReceiptExtractorService` como **4º** parâmetro; atualize `imports.upload-validation.spec.ts` (`new ImportsService({} as any, {} as any, {} as any, {} as any)`) e qualquer outro `new ImportsService(` (procure com grep).
- `previewReceiptImport`: mantém a validação do grupo e `ensureReceiptFile` na mesma ordem; **remove** as chamadas a `ensureReceiptAiEnabled` e `parseReceiptWithSelah` (os métodos ficam no arquivo, sem uso, com um comentário de uma linha dizendo que o Selah está desligado neste fluxo). Novo método privado `loadExpenseCategories(userId)` devolve `{ id, name, type }` das categorias de despesa, e `timezone` do usuário vem de `prisma.user.findUniqueOrThrow({ select: { timezone, financeCategories... } })`; `today = localToday(new Date(), timezone ?? 'America/Sao_Paulo')`.
- A resposta serializada (`serializeReceiptPreview`) ganha: `itemsSum: number | null`, `totalMismatch: { itemsSum, total, difference } | null`, `extraction: { method, ocrConfidence, warnings, qrDetected, secondPass }`, `accessKeyValid: boolean`. Notas antigas (sem esses campos no `previewData`): `itemsSum` e `totalMismatch` `null`, `extraction` `null`, `accessKeyValid` `false`. `purchaseSummary`, `purchaseMission` `null`; `spendingSignals` e `followUpActions` `[]` (os sinais determinísticos já calculados continuam).
- `confidence` calculada (substitui a do Selah): `'low'` se `totalMismatch` ou `items.length === 0` ou algum item com `lineConsistent === false`; senão `'high'` se `accessKeyValid` e `itemsSum !== null` e `warnings.length === 0`; senão `'medium'`.
- Campos do `ReceiptScan`: `merchantName`, `documentNumber`, `purchaseDate` (já é `Date` UTC meia-noite), `totalAmount`, `currency 'BRL'`, **`accessKey`** (coluna nova; só a chave válida de 44 dígitos), `rawText` e `previewData.rawTextExcerpt` = `rawTextRedacted`, `previewData.qrCodeText` = `qrCodeText`, `merchantTaxId` = `cnpj`, `documentType` = `'nfce'` se a chave decodificada tiver modelo `65`, senão `null`, `provider = 'LUMEN_LOCAL'`, `model = null`, `notes` = `extraction.warnings` (até 12).
- **Duplicata no preview:** além de `findPossibleDuplicateTransaction`, se houver `accessKey`, buscar `receiptScan.findFirst({ where: { userId, accessKey, status: IMPORTED }, include: { transaction: true } })`; achando, `possibleDuplicate = true` e a descrição vem da transação ligada. **Todas as buscas filtram por `userId` do token.** Chave importada por outro usuário não conta e não aparece.
- **Duplicata no commit** (`commitReceiptImport`), depois de achar a nota do usuário e antes de gravar: se `previewData.possibleDuplicate`, **ou** existir outra nota `IMPORTED` do mesmo `userId` com a mesma `accessKey` (id diferente; reconsulta no commit, porque pode ter mudado desde a prévia), e `dto.acknowledgeDuplicate !== true` → `ConflictException({ statusCode: 409, code: 'RECEIPT_DUPLICATE_UNCONFIRMED', message: 'Parece que você já lançou esta compra. Confirme para importar mesmo assim.' })`, sem gravar nada. Limite conhecido, a documentar no HANDOFF: dois commits simultâneos de notas diferentes com a mesma chave podem passar (a checagem é de aviso, não de unicidade).
- `CommitReceiptImportDto`: `@IsOptional() @IsBoolean() acknowledgeDuplicate?: boolean`.

### Banco

`schema.prisma`: em `model ReceiptScan` acrescente `accessKey String?` e `@@index([userId, accessKey])`. Migration `20261116120000_receipt_scan_access_key/migration.sql`:

```sql
ALTER TABLE "ReceiptScan" ADD COLUMN "accessKey" TEXT;
CREATE INDEX "ReceiptScan_userId_accessKey_idx" ON "ReceiptScan"("userId", "accessKey");
```

Rode `npm run prisma:generate` depois. Não rode `migrate dev` nem `migrate deploy` (o agente principal valida em Postgres descartável).
