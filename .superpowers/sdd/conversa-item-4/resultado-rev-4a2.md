# Resultado da revisão 4a-2 (parcial, em andamento)

Revisor: sonnet. Branch `feature/importar-nota-fiscal`, base `100627b`. Este arquivo é atualizado a cada etapa que fecha.

Ordem combinada: (1) isolamento A/B em Postgres e Redis descartáveis, (2) mutantes um por vez, (3) rede cortada e entradas hostis, (4) falha intermitente.

## Etapa 1: migration e A/B em Postgres real (FECHADA)

Containers próprios: `lumen-rev4a2-pg` (postgres:16-alpine, porta 55432, senha de teste) e `lumen-rev4a2-redis` (redis:7-alpine, porta 56379). O Postgres de dev (5432) não foi tocado. Remover os dois no fim.

Migration `20261116120000_receipt_scan_access_key`:
- Banco limpo: `prisma migrate deploy` aplicou as 28 migrations sem erro.
- Sobre o schema anterior: apliquei as 27 anteriores, inseri um usuário e uma `ReceiptScan` antiga, depois apliquei a nova. A linha antiga ficou com `accessKey` nulo, o índice `ReceiptScan_userId_accessKey_idx` existe e `migrate status` diz "Database schema is up to date".
- `prisma migrate diff` entre o banco migrado e `schema.prisma`: "No difference detected" (exit 0).

Cenário A/B com a API real (`node dist/main` contra esses containers, duas contas reais, `nota-n1.png` com OCR real), script `backend/test/receipt-ab.integration.mjs`:
- A importa a nota com chave K: prévia 201, `accessKeyValid=true`, `possibleDuplicate=false`, commit com o corpo antigo (sem `acknowledgeDuplicate`) 201.
- B importa a mesma nota (mesma chave K): prévia 201, `possibleDuplicate=false`, sem id nem descrição de duplicata de A, commit 201. Não é bloqueado e não vê nada de A.
- B tentando comitar a prévia de A: 404, com corpo idêntico ao de um id inexistente (ignorando timestamp e requestId). A lista de B não contém a prévia de A.
- A importa K de novo: prévia marca `possibleDuplicate=true`; commit sem `acknowledgeDuplicate` e com `false` dão 409 `RECEIPT_DUPLICATE_UNCONFIRMED` (o `code` chega ao cliente pelo filtro real); com `true` dá 201.
- HEIC dá 400 com a mensagem exata; PDF digitalizado dá 400 com a mensagem exata; `rawTextExcerpt` tem 500 caracteres no máximo.
- Linhas gravadas no banco: `provider = LUMEN_LOCAL`, `accessKey` preenchida só para a chave válida.
- Resultado: "TUDO OK", 18 verificações.

Achado de ambiente (não é bug do código): o cadastro tem limite de 3 por janela no Redis; foi preciso `flushall` no Redis descartável entre rodadas.

## Etapa 3 (adiantada): entradas hostis e concorrência com a API real (FECHADA)

Servidor real, upload multipart de um usuário real. Resultados:
- arquivo vazio: 400 "Formato invalido..."; texto com `Content-Type: image/png`: 400 (o tipo vem dos bytes, o MIME declarado é ignorado);
- PNG truncado, PNG com assinatura e lixo, JPEG com lixo: 400 "Não consegui abrir esta imagem...";
- PDF malformado: 422 `RECEIPT_UNREADABLE`; JPEG com EXIF de 60 KB: 422 `RECEIPT_UNREADABLE` (nota em branco sem total, esperado);
- PNG de 6000x5000 (30 MP): 400 "Imagem muito grande"; PNG bomba de descompressão 16000x16000 (256 MP, 249 KB no disco): 400 "Imagem muito grande" em 10 ms, sem decodificar;
- PDF com MIME `image/png` e PNG com MIME `application/pdf`: tratados pelos bytes (201), certo;
- cinco leituras simultâneas: 2 deram 201 e 3 deram 429 `RECEIPT_BUSY`; a leitura seguinte voltou a dar 201 (vaga liberada);
- nenhum 500; RSS do backend foi de 339 MB para 390 MB depois de tudo.

## Baseline de testes

`TZ=UTC npx jest src/imports`: 251 de 251 (12,7 s). `TZ=Asia/Tokyo` quatro rodadas seguidas: 251 de 251 em todas. `tsc --noEmit` 0 erros, `nest build` ok.

## Mutantes

Cada mutante foi aplicado sozinho, rodou o spec relevante, foi desfeito (`git checkout -- <arquivo>`, árvore tinha só o meu mutante) e `git status` voltou limpo.

- (a) tirar o limite de 2 leituras: MORTO por `terceira leitura simultanea responde RECEIPT_BUSY`. Observação: morre só por estouro do prazo de 120 s do teste (a 3ª leitura fica pendurada), não por asserção. Funciona, mas é lento; vale endurecer.
- (b) não liberar a vaga no `finally`: MORTO (3 testes de "a vaga volta depois de sucesso, erro e timeout").
- (c) tirar o limite de 25 MP: MORTO (a mensagem muda para "Não consegui abrir esta imagem", porque o `limitInputPixels` do segundo `sharp` ainda segura; o teste confere a mensagem exata).
- (d) tirar `.rotate()`: MORTO (`foto de celular e girada pelo EXIF`).
- (e) 2ª passada sempre: MORTO (`1a leitura boa nao chama a 2a`). 2ª passada nunca: MORTO (2 testes). Variante sem o gatilho `totalMismatch`: MORTO (`empate de pontuacao`).
- (f) OCR vence o QR na chave: MORTO (`chave do QR vence a do OCR e avisa W_KEY_CONFLICT`).
- (g) remover `userId`: (1) busca de chave duplicada no preview: MORTO (2 testes); (2) busca de chave no commit (`hasOtherImportedWithKey`): MORTO; (3) busca da nota no commit: MORTO (2 testes, inclui 404 igual a inexistente).
- (h) remover a checagem de `acknowledgeDuplicate`: MORTO (2 testes).
- (i) gravar `rawText` sem redação: o serviço só recebe `rawTextRedacted` do extrator (o texto bruto nunca sai do parser), então não há mutante no serviço. Mutante equivalente aplicado no parser (tirar `redactCpf` do texto guardado, desfeito logo): MORTO pelo teste do fluxo (`rawText sem CPF`). Lacuna: o teste só olhava `rawText`; vou cobrir também `previewData.rawTextExcerpt` e a resposta.
- (j) aceitar `totalAmount === null` com itens: MORTO.
- (k) `confidence` high sem `accessKeyValid`: MORTO (`medium: sem chave valida`).
- (l) timeout do OCR removido: MORTO (`prazo de 1 ms`).
- (m) `destroy` do PDF fora do `finally`: MORTO (`libera o documento mesmo quando getTextContent lanca`).

Resumo: 13 de 13 grupos mortos, 0 vivos. Dois pontos fracos de teste (não de código): (a) morre por estouro de prazo e não por asserção; (i) não conferia `previewData.rawTextExcerpt` nem a resposta.

## Rede cortada e privacidade (FECHADA)

- `unshare -rn` (só `lo`, DNS dá `EAI_AGAIN`), sem `SELAH_*`, rodei `npx ts-node test/receipt-extractor.smoke.ts` com OCR, QR e PDF reais: `nota-n1.png` 1844 ms, total 179,94, 10 itens, chave válida, 0 avisos; `nota-n1-jpeg.jpg` 4095 ms, total certo, 6 de 10 itens, aviso de soma; `nota-n2-texto.pdf` PDF_TEXT 11 itens, 473 ms; `nota-n1-digitalizada.pdf` recusado com a mensagem exata. Idioma vem de `@tesseract.js-data/por` local, `cacheMethod: 'none'`; nenhum `.traineddata` apareceu em `/tmp` nem no repositório.
- O teste do fluxo espia `http.request`, `https.request` e `fetch` e prova zero chamadas, sem consentimento de IA e sem `SELAH_*`.
- Log `Nota lida`: só método, segunda passada, tempo, nº de itens e nº de avisos. Nenhum texto lido em log; o teste espiona o logger.
- CPF: 11 formas (com pontos, só dígitos, espaços, "C.P.F.", com confusões de OCR `l`/`O`, barra no lugar de hífen, separado por quebra de linha, vírgulas) passadas pelo parser real: nenhuma vazou em `rawTextRedacted` nem no objeto serializado. O serviço usa `rawTextRedacted` em todos os pontos (`rawText`, `previewData.rawTextExcerpt`, resposta); o texto bruto nunca sai do parser. O teste agora confere os três e o limite de 500 caracteres.
- Nenhum arquivo de bytes em disco ou banco (conferido no teste de tmpdir e na inspeção do banco da integração).

## Entradas hostis, limites e recursos adicionais

- Imagem de 24 MP (6000x4000) com duas leituras simultâneas: 7,4 s no total, pico de RSS de 1134 MB. Dentro do contrato, mas o container precisa de memória para 2 leituras grandes (risco de dimensionamento, ver "Riscos").
- PDF não tem prazo de leitura (o contrato só fixa 30 s para OCR). Limite é 3 páginas e 10 MB.

## Falha intermitente (FECHADA)

Sem carga, nada falhou (quatro rodadas em Tokyo, 251 de 251). Reproduzi com carga: 8 execuções paralelas dos dois specs de OCR real (cada uma com `--maxWorkers=2`) deram 7 falhas em 8 execuções. Observação: essa carga derrubou a máquina (WSL reiniciou, sessão caiu); não repetir com 8, três paralelas bastam. Causas encontradas, todas de teste:

1. **Teste de "nenhum arquivo em disco" listava o `/tmp` inteiro** antes e depois da leitura e comparava. Outro processo da máquina (`habblaud-*`) ou outro worker do jest criando arquivo no meio fazia o teste falhar. É a causa mais provável das duas falhas únicas (Tokyo e suíte inteira). Correção: `os.tmpdir()` do código aponta para uma pasta só do teste (espião) e as escritas (`writeFileSync`, `createWriteStream`, `appendFileSync`, `promises.writeFile`) são espiadas. Provado com mutante que grava `/tmp/vazou.png` (o teste falha e mostra o arquivo; antes da correção esse mutante sobrevivia).
2. **Prazos de 90 s e 120 s do OCR real** estouravam com a máquina saturada: `OcrPool › com prazo de 1 ms` caiu por `OcrTimeoutError` de um `recognize(png, 90_000)`, e o teste do JPEG passou dos 120 s do jest. Correção: prazos de 250 s e jest de 300 s nesses testes, e o serviço ganhou o campo `ocrBudgetMs` (padrão 30 s, o limite do código não mudou); o teste de ponta a ponta o sobe para 200 s. Um teste novo confere que em produção o prazo passado ao OCR é de 30 s.

Depois da correção: 3 execuções paralelas, 30 de 30 em todas. `terminate` do worker não trava: `recognize(png, 50)` rejeitou em 50 ms.

## Achados e correções

Nenhum bug de segurança ou de isolamento. Corrigido:

- (média, recurso) `OcrPool.spawn`: se `setParameters` falhasse depois de `createWorker`, o worker ficava vivo, fora do pool, sem ninguém para terminá-lo. Agora termina no erro. Commit `956a5ac`. Sem teste (exigiria simular falha do tesseract); coberto só por leitura.
- (baixa, recurso) `readPdfText`: PDF que o pdfjs não abre (corrompido ou com senha) deixava a tarefa de carga retida. Agora `task.destroy()`. Teste novo. Commit `956a5ac`.
- (teste) vaga de leitura: o mutante (a) morria só por estouro de 120 s; agora falha em 1 s. Commit `b8ef57b`.
- (teste) privacidade: conferia só `rawText`; agora também `previewData.rawTextExcerpt`, resposta, `previewData` inteiro e o limite de 500. Commit `b8ef57b`.
- (teste) causa da falha intermitente, acima. Commit `642ef80`.
- Revisão do diff contra o contrato, regra por regra: `confidence` (low por `totalMismatch`, sem itens ou linha inconsistente; high só com chave válida, `itemsSum` e zero avisos; medium no resto), `itemsSum`, `totalMismatch`, `extraction`, `accessKeyValid`, `provider LUMEN_LOCAL`, campos de `ReceiptScan`, `documentType` pelo modelo 65, notas até 12, duplicata no preview e no commit com `userId`, 409/422/429 com `code` pelo filtro real, nota antiga serializa sem erro, corpo antigo do commit grava, `ensureReceiptAiEnabled` e `parseReceiptWithSelah` seguem no arquivo sem uso. Sem divergência.

Não corrigido (registrar, sem mudar contrato):

- PDF sem prazo de leitura: um PDF hostil (até 10 MB, 3 páginas) pode ocupar CPU do processo; o contrato só fixa 30 s para OCR. Recomendação: decidir se entra um prazo de PDF na 4a-3 ou no hardening.
- Memória: duas leituras de 24 MP simultâneas chegaram a 1,1 GB de RSS. Dimensionar o container (ou baixar o teto de megapixels). Sem mudança de código.
- Dois commits simultâneos com a mesma chave podem passar (limite já documentado no contrato; é aviso, não unicidade).
- `OcrPool.onModuleDestroy` não impede uma criação de worker que esteja em andamento de entrar no pool depois (janela curta no desligamento).

## Números finais (commit `642ef80`)

- `tsc --noEmit` 0 erros; `nest build` ok.
- `npx jest src/imports`: 253 de 253 em `UTC`, 253 de 253 em `America/Sao_Paulo`, 253 de 253 em `Asia/Tokyo` (5 suítes).
- Suíte inteira `npx jest --maxWorkers=2`: 52 suítes, 1435 de 1435 testes.
- Smoke real: `nota-n1.png` 2113 ms, total 179,94, 10 itens, 0 avisos; `nota-n1-jpeg.jpg` 4184 ms, total certo, 6 de 10 itens, aviso `W_TOTAL_MISMATCH`; `nota-n2-texto.pdf` 11 itens, 444 ms; `nota-n1-digitalizada.pdf` recusado com a mensagem exata.
- A/B em Postgres real refeito no build final (containers recriados): "TUDO OK". Containers `lumen-rev4a2-*` removidos, servidor parado.

## Não verificado

- Notas reais (só sintéticas); o portão 9 do contrato continua do dono.
- Postgres e Redis de produção; o A/B usou Postgres 16 e Redis 7 descartáveis.
- Falha de `createWorker`/`setParameters` do tesseract não tem teste (só leitura do código).
- Suíte inteira com todos os workers (sem `--maxWorkers`): não rodei de novo, o ambiente caiu com carga alta; só `--maxWorkers=2`. A causa provável da falha única nessa condição é o teste do `/tmp` (corrigido), mas não reproduzi a falha exata.
- O front e o chat não fazem parte desta revisão.
- Prazo de leitura de PDF hostil: não medido.
