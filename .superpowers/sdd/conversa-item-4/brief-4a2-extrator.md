# Brief 4a-2: extrator de nota fiscal e integração no ImportsService (subagente haiku)

Você implementa a leitura local (QR, PDF com texto, OCR) e liga o resultado ao `ImportsService`, com testes. Relate em caveman terse (português); código, comentários e commits em prosa normal.

## Antes de começar

- Repositório: `/home/caminhao/coding/codeStage/Lumen`, branch `feature/importar-nota-fiscal` (confira com `git branch --show-current`; outra = pare e avise).
- Leia, nesta ordem: `.superpowers/sdd/conversa-item-4/contrato-tipos.md` (seção **"Parte 4a-2"**: é o seu contrato; a "Parte 4a-1" descreve o parser que você vai usar), `docs/superpowers/specs/2026-11-16-conversa-contrato-item-4.md` (seções 6, 7, 10 e 13), `backend/src/imports/receipt-text.parser.ts` (as funções exportadas e `RECEIPT_WARNINGS`) e `backend/src/imports/imports.service.ts` (`previewReceiptImport`, `commitReceiptImport`, `serializeReceiptPreview`, `findPossibleDuplicateTransaction`).
- As dependências (`sharp`, `jsqr`, `tesseract.js`, `@tesseract.js-data/por`, `pdfjs-dist`) já estão em `backend/package.json` e instaladas em `backend/node_modules`. **Não adicione nem atualize nenhuma dependência** e não mexa em `package.json` nem em `package-lock.json`.
- Fixtures sintéticas e gabarito: `backend/test/fixtures/receipts/` (`truth.json`).
- Protótipos descartáveis de referência (não copie cegamente): `.superpowers/sdd/conversa-item-4/spike/eval.js` (QR e OCR) e `spike/pdf.js` (pdfjs). Relatório com os fatos medidos: `.superpowers/sdd/conversa-item-4/relatorio-4-0.md`.

## O que criar e alterar

Exatamente a tabela de arquivos da "Parte 4a-2" do contrato. Mais:

- `backend/src/imports/receipt-extractor.service.spec.ts`, `receipt-readers.spec.ts` e `imports.receipt-flow.spec.ts` (testes do `ImportsService` com Prisma simulado).
- Não toque em mais nada, nem nos arquivos do parser (`receipt-text.parser*`). Se achar bug no parser, registre em `.superpowers/sdd/conversa-item-4/duvidas.md` e siga.

## Armadilhas já conhecidas (leia antes de codar)

1. **ESM em CommonJS:** `pdfjs-dist/legacy/build/pdf.mjs` só carrega por `import()` real. O TypeScript do projeto compila para CommonJS e transformaria `import()` em `require()`. Use `new Function('specifier', 'return import(specifier)')`, como o contrato manda. Isso **não funciona dentro do jest** (sem `--experimental-vm-modules`): por isso `readPdfText` recebe um `importer` opcional e os testes do jest usam um importador falso; a leitura real do PDF é provada pelo script `backend/test/receipt-extractor.smoke.ts` (rode com `npx ts-node test/receipt-extractor.smoke.ts`).
2. **Sem `esModuleInterop`:** `import sharp from 'sharp'` compila para `sharp_1.default` e dá `undefined` em tempo de execução. Use `import sharp = require('sharp')`. O `jsqr` usa `require` com tipo mínimo escrito por você.
3. **Tesseract offline:** o idioma vem de `@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz` (`gzip: true`). Nenhuma chamada de rede em tempo de execução. Confira as opções de `createWorker` da versão 7.0.0 em `backend/node_modules/tesseract.js` e desligue o cache em disco se a opção existir; se não existir, use `cachePath` dentro de `os.tmpdir()`.
4. **Foto de celular vem deitada:** `.rotate()` sem argumento (EXIF) antes do QR e do OCR.
5. **Timers:** todo `setTimeout` de timeout é limpo em `finally`; senão o jest acusa handle aberto. Workers do tesseract são terminados em `onModuleDestroy` e nos testes (`afterAll`).
6. **Datas:** só UTC (`Date.UTC`, getters `getUTC*`); "hoje" vem de `localToday(new Date(), timezone)` de `../recurring-transactions/recurrence.util`.
7. **Privacidade:** nunca logar o texto lido, nunca gravar bytes do arquivo em disco ou banco, nunca devolver CPF. O que vai para `rawText` e `previewData.rawTextExcerpt` é `rawTextRedacted` do parser.

## Regras do projeto

- Nada de `sed -i`, `perl -i`, `python` ou edição de arquivo por shell: use as ferramentas de edição. Nada de `sleep`. Não rode `prisma migrate dev` nem `migrate deploy`; rode só `npx prisma generate` (com `DATABASE_URL` qualquer, se precisar).
- `strictNullChecks` está desligado, mas trate `null` explicitamente. Dinheiro em centavos nas comparações.
- Comentário só onde o motivo não é óbvio, em português.
- Os métodos `ensureReceiptAiEnabled` e `parseReceiptWithSelah` **ficam** no arquivo (Selah desligado, não removido).

## Testes obrigatórios (cada linha é um teste que precisa falhar se a regra for removida)

**`receipt-readers.spec.ts` (bibliotecas reais, fixtures):**
- `decodeQr(nota-n1.png)` devolve texto com a chave de `truth.json`; `extractAccessKeyFromQr` dessa saída dá a chave certa.
- `decodeQr` de imagem sem QR devolve `null` (gere em memória com `sharp({ create })`).
- `decodeQr` respeita o prazo: com `deadlineMs = 0` devolve `null` rápido sem lançar.
- `OcrPool.recognize(nota-n1.png)`: o texto contém `VALOR TOTAL` e o total do gabarito (use `parseReceiptText` e compare `totalAmount`). Timeout: com `timeoutMs = 1` rejeita, o worker é removido do pool e a próxima chamada funciona (pool se recria).
- `readPdfText` com importador falso: junta `items[].str` com quebra em `hasEOL`, lê no máximo 3 páginas (crie um falso com 5), chama `destroy` mesmo quando `getTextContent` lança.

**`receipt-extractor.service.spec.ts` (leitores simulados para as regras; bibliotecas reais para 2 testes de ponta a ponta com `nota-n1.png` e `nota-n1-jpeg.jpg`):**
- Terceira leitura simultânea → `ReceiptBusyError` (429, `code: 'RECEIPT_BUSY'`); a vaga é liberada depois de sucesso, de erro e de timeout (rode 3 leituras em sequência após cada caso).
- HEIC → 400 com a mensagem exata; PDF sem texto (`readPdfText` falso devolve 10 caracteres) → 400 com a mensagem exata; imagem com mais de 25 megapixels (gere `sharp({ create: { width: 6000, height: 5000, channels: 3, background: '#fff' } }).png()`) → 400 e **o OCR nem é chamado**; arquivo que não é imagem (bytes aleatórios com assinatura PNG) → 400 "Não consegui abrir".
- Fluxo de passadas: 1ª leitura sem total → chama a 2ª (pré-processamento) e escolhe a de maior pontuação; 1ª leitura boa → **não** chama a 2ª (`secondPass: false`); empate fica com a 1ª.
- `totalAmount === null` depois de tudo → `ReceiptUnreadableError` (422, `code: 'RECEIPT_UNREADABLE'`); total lido sem itens é aceito com `W_NO_ITEMS`.
- Timeout do OCR → `ReceiptUnreadableError` com a mensagem de tempo e a vaga liberada.
- PDF com texto (`nota-n2-texto.pdf` com importador falso devolvendo o texto do gabarito): `method: 'PDF_TEXT'`, `ocrConfidence: null`, sem chamar QR nem OCR.
- Chave do QR vence a do OCR (QR com chave válida, OCR com outra válida → usa QR e aviso `W_KEY_CONFLICT`).
- Ponta a ponta com `nota-n1.png` (OCR real): total, data, CNPJ e chave iguais ao gabarito. Para `nota-n1-jpeg.jpg`: não precisa acertar; precisa **não ter erro silencioso**: ou `totalAmount` igual ao gabarito, ou algum aviso presente, ou `ReceiptUnreadableError`.
- Nenhum arquivo é criado em disco durante a leitura (compare `fs.readdirSync(os.tmpdir())` antes e depois) e nenhum `console.log`/`Logger.log` recebe pedaço do texto lido (espie o logger).

**`imports.receipt-flow.spec.ts` (ImportsService com Prisma simulado e extrator simulado):**
- Preview sem consentimento de IA e sem variáveis `SELAH_*`: funciona (não chama `parseReceiptWithSelah`; espie `fetch`/`http`/`https` e prove que não houve rede).
- Preview grava `accessKey`, `rawText` sem CPF, `provider 'LUMEN_LOCAL'`; resposta traz `itemsSum`, `totalMismatch`, `extraction`, `accessKeyValid`; `confidence` nos três casos (`high`, `medium`, `low`) e em cada gatilho de `low`.
- Nota antiga (sem os campos novos no `previewData`) serializa sem erro.
- Duplicata: sem `acknowledgeDuplicate` → 409 `RECEIPT_DUPLICATE_UNCONFIRMED` e **nenhum** `$transaction`/`create` chamado; com `true` grava; chave já importada pelo mesmo usuário bloqueia; **a consulta de chave sempre leva `userId` do token** (verifique o `where` das chamadas ao Prisma simulado); chave só de outro usuário não bloqueia (o Prisma simulado respeita o `where`).
- Isolamento: `commitReceiptImport` e a leitura da nota usam `userId` no `where`; nota de outro usuário → 404 igual a inexistente.
- Regressão: commit com o corpo antigo (sem `acknowledgeDuplicate`) de nota sem duplicata continua gravando.

**Fuso:** rode as suítes novas também com `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`. `purchaseDate` da prévia é meia-noite UTC.

## Como verificar (cole os números reais no relatório)

```bash
cd /home/caminhao/coding/codeStage/Lumen/backend
npx prisma generate
npx tsc --noEmit -p tsconfig.json
npx jest src/imports
TZ=America/Sao_Paulo npx jest src/imports
TZ=Asia/Tokyo npx jest src/imports
npx nest build
npx ts-node test/receipt-extractor.smoke.ts        # lê as 4 fixtures reais e imprime método, total, itens, avisos, tempo
npx jest 2>&1 | tail -8                              # suíte inteira do backend
```

Teste vermelho = não commitar.

## Mutantes (à mão, desfazendo depois; relate vivos e mortos; vivo = escreva o teste que o mata)

(a) tirar o limite de 2 leituras simultâneas; (b) não liberar a vaga no `finally`; (c) tirar o limite de 25 megapixels; (d) tirar `.rotate()`; (e) 2ª passada sempre executada, e nunca executada; (f) trocar a escolha da chave (OCR vence o QR); (g) remover `userId` da busca de chave duplicada no preview, no commit e na busca da nota; (h) remover a checagem de `acknowledgeDuplicate`; (i) gravar `rawText` sem `rawTextRedacted`; (j) tratar `totalAmount === null` com itens como aceito; (k) `confidence` `high` sem exigir `accessKeyValid`.

## Entrega

- Dois commits locais, caminhos explícitos: (1) `feat(imports): leitor local de nota fiscal por QR, PDF e OCR (item 4a-2)` com os arquivos do extrator, módulo e testes dos leitores; (2) `feat(imports): prévia de nota sem IA, duplicata exige decisão e coluna accessKey (item 4a-2)` com `imports.service.ts`, DTO, controller, schema, migration e testes do fluxo. Corpo em português e linha final `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Nunca `git add -A`, amend, reset ou push. `index.lock` = esperar e repetir.
- Relatório final curto: arquivos, números reais dos testes (três fusos, suíte inteira), saída do smoke, mutantes, dúvidas. Dúvida de contrato vai para `duvidas.md` e para o relatório.
