# Contrato do item 4: importar nota fiscal sem IA

Data: 2026-11-16. Status: **aprovado pelo dono em 2026-11-16**. D1 (notas reais) segue sem resposta: a fase 4.0 começa com notas sintéticas. Decisões D2, D3, D5, D6 e D8 valem como recomendadas; D4 e D7 continuam abertas. Nenhum código de produção foi escrito. Branch de trabalho: `feature/importar-nota-fiscal` (base `master` em `bbd8b49`, tag `v1.6.0`).

Fonte da ordem de trabalho: `docs/superpowers/specs/2026-11-14-assistente-manual-financas.md`, seção "Ordem de implementação", item 4 ("Trocar extração de nota por OCR/QR e conectar prévia/revisão ao roteador"), e a seção "Importação de nota sem LLM" do mesmo arquivo. Direção de produto: `docs/superpowers/plans/2026-11-14-assistente-manual-importacao-planos.md`.

Convenção deste documento: **Verificado** = li o código ou rodei. **Presumido** = vem de conhecimento geral e precisa ser provado com amostras antes de virar promessa.

## 1. Objetivo

Hoje, ler uma nota fiscal por foto ou PDF só funciona se o Selah (IA externa) estiver ligado e o usuário tiver consentido. O lançamento do Lumen será sem IA. O item 4 troca a extração por um leitor local e determinístico (QR Code, texto do PDF e OCR), mantém a revisão e a comparação de preços que já existem, e deixa o chat apontar para essa importação.

Regra que pesa mais: **a nota nunca grava sozinha, e uma leitura errada nunca pode passar por certa.** O leitor erra com frequência em cupom térmico fotografado; por isso o desenho foca em mostrar a divergência, e não em esconder o erro.

## 2. Situação atual (verificado)

- `POST /imports/receipts/preview` (multipart `file`, campos `tagGroupId` obrigatório e `compareWithPrevious`) chama `ImportsService.previewReceiptImport`. Esse método exige `ensureReceiptAiEnabled` (consentimento de IA do usuário) e `parseReceiptWithSelah` (chamada HTTP ao Selah com a imagem em base64). Sem `SELAH_ASSISTANT_ENABLED` ele falha com "A leitura de nota fiscal por IA nao esta habilitada neste ambiente."
- A resposta do Selah segue o tipo `ReceiptParseResponse` (estabelecimento, CNPJ, número, chave, data, total, itens, QR e campos de "leitura" como `purchaseSummary`, `purchaseMission`, `spendingSignals`, `followUpActions`). O serviço normaliza, sugere categoria, detecta possível duplicata (mesmo valor, mesmo dia, nome parecido, em `findPossibleDuplicateTransaction`) e grava `ReceiptScan` (status `PREVIEWED`) com `ReceiptScanItem`.
- `POST /imports/receipts/commit` cria a despesa dentro de uma transação, troca os itens editados e marca a nota como `IMPORTED`. Hoje a duplicata é só um aviso: o commit não exige decisão do usuário.
- A comparação de preço por item (`buildReceiptItemPriceComparisons`) e a quebra por categoria já são determinísticas e ficam como estão.
- Limites de arquivo: imagem até 8 MB, PDF até 10 MB, tipo pelos bytes (`sniffMime`: JPEG, PNG, WEBP, GIF, HEIC, PDF).
- Tela `features/imports/imports-page`: o upload só aparece se `canUseReceiptAi` (consentimento de IA); caso contrário mostra "IA externa desativada". Há um bloco "Leitura Selah da compra" que só aparece quando o Selah devolveu resumo, sinais ou ações.
- Não há biblioteca de OCR, QR ou PDF no `backend/package.json`. O `Dockerfile` do backend usa `node:20-bookworm-slim` e instala com `npm ci --ignore-scripts`.
- O chat (motor de conversa) não tem a intenção "importar nota". O catálogo v0 do plano prevê a frase `importar nota`.

## 3. O que condiciona o desenho

1. **O QR Code da nota não traz os itens (presumido).** O QR da NFC-e carrega a URL de consulta da SEFAZ do estado e a chave de acesso de 44 dígitos. A chave, por si só, revela UF, mês e ano de emissão, CNPJ do emitente, modelo, série e número (decodificação determinística, com dígito verificador módulo 11). Não traz estabelecimento por nome, itens nem, em geral, o valor. Para obter os itens seria preciso abrir a página da SEFAZ de cada estado (27 formatos, captcha em alguns, termos de uso incertos, risco de requisição forçada a destino arbitrário). **Fora de escopo deste item** e registrado como decisão do dono (seção 11, D3).
2. **Itens e total vêm do texto impresso (OCR de foto ou texto do PDF).** Em PDF com camada de texto (DANFE enviado por e-mail) o texto sai exato. Em foto de cupom térmico o OCR erra dígitos, e isso é aceito: a prévia compara a soma dos itens com o total e mostra a diferença.
3. **A precisão não pode ser prometida sem amostras.** Ninguém mediu o OCR em notas reais deste produto. O item começa com uma medição (fase 4.0) e só avança com um limiar acordado.
4. **O repositório é público.** Nota real tem CPF, CNPJ e nome de loja. Fixtures reais não entram no Git. Testes usam texto sintético e imagens geradas na hora ou fictícias.
5. **Dependências novas exigem aprovação do dono.** A escolha de bibliotecas fica para a fase 4.0, com versão, licença e tamanho conferidos.

## 4. Fatiamento e ordem

| Fase | O que é | Quem | Saída |
|---|---|---|---|
| 4.0 | Medição: escolher bibliotecas e medir acurácia com amostras | agente principal com o dono | Relatório com a taxa de acerto de total, data, CNPJ e itens; lista de bibliotecas com versão e licença; decisão go/no-go |
| 4a | Extrator local no backend, troca da fonte do `previewReceiptImport`, duplicata exigindo decisão, redação de CPF | subagente haiku, revisão sonnet | Backend verde e revisado |
| 4b | Tela de importação sem o portão de IA, aviso de divergência de soma, decisão de duplicata | subagente haiku, revisão sonnet | Frontend verde e revisado |
| 4c | Intenção `importar nota` no chat, que abre a tela de importação | agente principal (pequeno) | Motor e cartão verdes |

Uma fase por vez. 4a e 4b têm contrato de tipos próprio em `.superpowers/sdd/conversa-item-4/contrato-tipos.md`, escrito depois da 4.0.

**Não entra no item 4:** upload de foto dentro do chat (fica para o WhatsApp, item 5), consulta à SEFAZ, franquia de notas por plano, edição de nota já importada, remoção do código do Selah.

## 5. Fase 4.0: medição

1. O dono fornece **10 a 20 notas reais**, de preferência variadas: supermercado, farmácia, posto, restaurante; foto reta e torta; PDF com texto; NFC-e e cupom não fiscal. As amostras **ficam fora do repositório** (pasta local ignorada) e são apagadas ao fim. Sem amostras reais, a medição usa só notas sintéticas e o resultado vale menos.
2. Candidatas a avaliar, versões e licenças conferidas no registro npm em 2026-11-16: `tesseract.js` 7.0.0 (Apache-2.0, OCR em WASM), `jsqr` 1.4.0 (Apache-2.0, QR em JS puro), `zxing-wasm` 3.1.7 (MIT, alternativa para QR), `sharp` 0.35.5 (Apache-2.0, decodificar e redimensionar imagem), `pdfjs-dist` 6.5.438 e `pdf-parse` 2.4.5 (Apache-2.0, texto de PDF; ambos grandes, 21 a 37 MB). A medição escolhe o conjunto mínimo.
3. Pontos a provar: `sharp` precisa instalar no `npm ci --ignore-scripts` do Dockerfile; o dado de idioma do OCR (português) tem que ser empacotado no repositório ou na imagem, **sem baixar de CDN em tempo de execução**; consumo de memória e tempo por nota num container pequeno; HEIC (foto de iPhone) é lido ou recusado com mensagem clara.
4. Critério de aceite para seguir (proposto): na amostra real, **total correto em pelo menos 80% das notas** e **nenhum caso em que a soma dos itens não bate com o total e a tela não avisa**. Abaixo disso, a 4a muda de desenho (por exemplo, QR e PDF só, foto só com digitação assistida) e o dono decide.

## 6. Contrato do extrator (4a)

Novo serviço `ReceiptExtractorService` em `backend/src/imports/`, injetado no `ImportsService`. Sem rede, sem IA.

Entrada: `{ buffer: Buffer, mimeType: SniffedMime, fileName: string }`. Saída: o mesmo formato que `ReceiptParseResponse` já descreve, mais:

```ts
extraction: {
  method: 'QR' | 'PDF_TEXT' | 'OCR';   // fonte principal do preenchimento
  ocrConfidence: number | null;         // 0 a 1, quando houver OCR
  warnings: string[];                   // texto para a prévia, em português
}
```

Regras de extração:

1. **Ordem:** PDF com texto útil → `PDF_TEXT`; imagem ou PDF sem texto → QR primeiro (para a chave), depois OCR para itens e total. QR e texto se complementam; a chave vinda do QR vence a vinda do OCR.
2. **Chave de acesso:** 44 dígitos, aceita com espaços. Só vale se o dígito verificador módulo 11 bater. Chave inválida vira aviso, não é guardada como se fosse certa.
3. **Valores:** formato brasileiro (`1.234,56`, `32,90`); ponto como milhar. Valor ambíguo ou fora de faixa (zero, negativo, acima de R$ 1.000.000,00) não é aceito; vira aviso.
4. **Data:** `dd/mm/aaaa` e `dd/mm/aa`; ano de 2 dígitos assume 2000 a 2099. Data futura ou anterior a 2000 não é aceita; vira aviso. A data é gravada como data pura à meia-noite UTC, igual aos lançamentos (ver `monthToDateUtc`).
5. **Itens:** linha com descrição, quantidade, unidade, preço unitário e total do item. Linha que não fecha (quantidade × unitário ≠ total do item acima de R$ 0,01) entra marcada em `warnings`. Quantidade com até 3 casas (peso).
6. **Total:** procurar rótulos `TOTAL`, `VALOR TOTAL`, `VALOR A PAGAR`. Se houver mais de um candidato, escolher o que bate com a soma dos itens; se nenhum bate, escolher o maior rotulado e avisar.
7. **CNPJ:** 14 dígitos com dígito verificador válido. CPF do consumidor **nunca** é extraído nem guardado.
8. **Privacidade:** antes de gravar `rawText` e `previewData.rawTextExcerpt`, remover CPF (padrão `000.000.000-00` ou 11 dígitos após "CPF") e truncar em 500 caracteres. O `qrCodeText` guardado é só a URL sem parâmetros além da chave. O arquivo (bytes) **não** é gravado em disco nem no banco; arquivo temporário, se existir, é apagado em `finally`.
9. **Limites de recurso:** imagem até 25 megapixels (recusa acima, para evitar imagem que expande na memória); PDF até 3 páginas lidas; OCR com limite de 30 segundos; no máximo 2 leituras ao mesmo tempo por processo (a terceira responde "Muitas leituras agora, tente em instantes" com HTTP 429). O limite de tamanho de arquivo atual (8 MB imagem, 10 MB PDF) não muda.
10. **Falha de leitura:** sem total confiável e sem nenhum item, a prévia **não é criada** e a resposta é HTTP 422 com `code: 'RECEIPT_UNREADABLE'` e a orientação de lançar o gasto pelo chat ou pela tela de Finanças. (Decisão D2.)

## 7. Mudanças na API existente (4a)

Os dois endpoints e os nomes de campo atuais continuam. Só há acréscimos, para o front antigo não quebrar.

**`POST /imports/receipts/preview`**
- Deixa de exigir consentimento de IA (`ensureReceiptAiEnabled`) e de chamar o Selah. O grupo de tags (`tagGroupId`) continua obrigatório e validado antes de processar.
- Resposta ganha:
  - `itemsSum: number | null`: soma dos itens, ou `null` sem itens;
  - `totalMismatch: { itemsSum: number; total: number; difference: number } | null`: preenchido quando a diferença passa de R$ 0,01; o texto equivalente também entra em `notes`;
  - `extraction: { method, ocrConfidence, warnings }`;
  - `accessKeyValid: boolean`.
- `confidence` ('low' | 'medium' | 'high') passa a ser calculada: `high` só com chave válida e soma batendo; `low` com divergência ou aviso de linha; `medium` no resto.
- `purchaseSummary`, `purchaseMission`, `spendingSignals` e `followUpActions` ficam `null` / `[]`. Os sinais determinísticos já calculados (quebra por categoria e comparação de preço) continuam.
- Erros: 400 formato inválido ou arquivo grande (como hoje); 404 grupo inexistente (como hoje); **422 `RECEIPT_UNREADABLE`**; **429 `RECEIPT_BUSY`**.

**`POST /imports/receipts/commit`**
- Novo campo opcional no corpo: `acknowledgeDuplicate?: boolean`.
- Se a nota tiver duplicata provável (`possibleDuplicate`) **ou** chave de acesso já importada pelo mesmo usuário, e `acknowledgeDuplicate` não for `true`, responde HTTP 409 com `code: 'RECEIPT_DUPLICATE_UNCONFIRMED'` e não grava nada.
- Isolamento: toda busca de duplicata e de nota usa `userId` do token. Chave importada por outro usuário **não** conta nem aparece.

**Banco (migration aditiva):** `ReceiptScan.accessKey String?` com índice `(userId, accessKey)`, preenchido na prévia, para a checagem de chave repetida sem varrer JSON. Nota antiga fica com `null` e continua valendo só pela regra atual de duplicata. Sem backfill obrigatório.

**Selah:** o código de `parseReceiptWithSelah` e as variáveis `SELAH_*` ficam no repositório. Com a configuração de IA em `OFF` (padrão deste item), o preview **não** o chama. Não há troca silenciosa entre extrator local e Selah.

## 8. Tela de importação (4b)

Arquivo: `frontend/src/app/features/imports/imports-page/`.

1. Remover o portão `canUseReceiptAi` e o bloco "IA externa desativada" do fluxo de nota. O upload fica sempre disponível.
2. Quando `totalMismatch` vier preenchido, mostrar no topo da prévia, com destaque, "A soma dos itens (R$ X) é diferente do total da nota (R$ Y)", antes do botão de confirmar. O botão continua habilitado (o usuário pode corrigir ou aceitar), mas o aviso não pode ser dispensado sem ação visível.
3. Quando `extraction.warnings` tiver itens, listar. Quando `confidence` for `low`, texto "Leitura incerta, confira cada linha."
4. Quando `possibleDuplicate` ou chave repetida, trocar o aviso atual por uma caixa de decisão: "Parece que você já lançou esta compra" com a descrição do lançamento parecido, e o botão de confirmar vira "Importar mesmo assim". O front envia `acknowledgeDuplicate: true` só depois dessa ação.
5. Esconder o bloco "Leitura Selah da compra" quando vazio (já é condicional) e trocar o título por "Resumo da compra" quando houver sinais determinísticos.
6. Tema claro e escuro e 360 px como estão; sem cor, fonte ou componente novo.
7. Tratar 422 (mostrar a orientação) e 429 (tente de novo) com mensagem do servidor; tratar 409 abrindo a caixa de duplicata.

## 9. Chat: intenção `importar nota` (4c)

1. Matcher: as frases `importar nota`, `importar nota fiscal`, `ler nota` e `enviar nota` (frase sozinha ou até 3 palavras sem `?`, mesma regra das leituras) viram a intenção `import_receipt`. Não pode capturar prompts rápidos do Selah.
2. Resposta: tipo `HELP` (existente), texto "Para importar uma nota, abra Importações e envie a foto ou o PDF. A leitura é feita aqui no Lumen e você confere tudo antes de gravar." e `data.screen = 'imports'` (campo novo opcional em `ReplyData`).
3. O motor **não cria rascunho nem sessão** e não grava nada. Registra o evento `import_receipt` com resultado `RECOGNIZED`.
4. O front mostra um botão "Abrir importações" que navega para a rota `imports`, só quando `data.screen === 'imports'`. Turno manual continua só em memória.
5. Upload de arquivo dentro do chat e estado `AWAITING_IMPORT_REVIEW` ficam para o item 5 (WhatsApp), onde a prévia chega por link seguro.

## 10. Testes e segurança

Matriz mínima (cada linha é um teste que precisa falhar sem a regra):

- **Parser e validação:** valores (`1.234,56`, `32,90`, `0,00`, negativo, milhões), datas (válida, futura, 2 dígitos, inválida), chave de 44 dígitos (DV certo, errado, com espaços), CNPJ (DV certo e errado), soma de itens (bate, diverge por R$ 0,02, diverge por R$ 0,01), quantidade por peso, linha de item que não fecha, escolha do total entre candidatos.
- **Privacidade:** CPF no texto bruto é removido antes de gravar; o excerto tem no máximo 500 caracteres; nenhuma gravação de bytes do arquivo; `qrCodeText` sem parâmetros extras.
- **Recursos:** imagem acima de 25 megapixels recusada; PDF com mais de 3 páginas lê só 3; terceira leitura simultânea recebe 429; timeout do OCR vira erro tratado e libera o limite.
- **Duplicata:** sem `acknowledgeDuplicate` retorna 409 e não grava; com `true` grava; chave já importada pelo mesmo usuário bloqueia; **chave importada por outro usuário não bloqueia nem vaza**.
- **Isolamento A/B:** usuário B não lê, comita nem enxerga `receiptScanId` do usuário A (404 igual a inexistente).
- **Regressão:** preview e commit de nota com o formato antigo da resposta continuam funcionando; comparação de preço e quebra por categoria inalteradas; a importação de CSV não é tocada.
- **Chat:** `importar nota` abre a resposta com `data.screen`; frase longa, com `?` e prompts rápidos do Selah não casam; nenhum rascunho ou sessão é criado.
- **Mutantes (obrigatórios na revisão):** retirar o filtro `userId` da busca de duplicata, do commit e da leitura da nota; trocar o dígito verificador por sempre verdadeiro; remover a redação de CPF; remover a checagem de `acknowledgeDuplicate`; trocar a tolerância de soma (R$ 0,01) por `>=`; remover o limite de megapixels e o de leituras simultâneas.
- **Real:** revisão com Postgres e Redis descartáveis, backend real, front real no Chrome, duas contas, e as amostras sintéticas. Vale a regra de portas de outros projetos do `HANDOFF.md`.

Este item é de segurança (dado pessoal e arquivo enviado por usuário). O revisor `sonnet` é obrigatório.

## 11. Decisões abertas do dono

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Fornecer 10 a 20 notas reais para a fase 4.0 (ficam fora do Git e são apagadas depois)? | Sim. Sem elas a precisão é chute. Se não quiser, a 4.0 usa só notas sintéticas e o resultado vale menos. |
| D2 | Nota ilegível (sem total e sem itens): recusar com orientação, ou abrir prévia vazia para digitar? | Recusar (422) e orientar a lançar pelo chat ou pela tela de Finanças. A prévia vazia duplica o lançamento manual que já existe. |
| D3 | Buscar os itens na página da SEFAZ pelo QR Code? | Não neste item. Risco de segurança e quebra por estado. Reavaliar depois do WhatsApp, só se a taxa de acerto do OCR for baixa. |
| D4 | Aprovar as bibliotecas escolhidas na fase 4.0 (versão e licença conferidas)? | Decidir ao fim da 4.0, com o relatório na mão. |
| D5 | Duplicata passa a exigir confirmação explícita no commit (409 sem `acknowledgeDuplicate`)? | Sim. É o que o spec do assistente manual já manda ("exige decisão explícita"). |
| D6 | Adicionar a coluna `ReceiptScan.accessKey` (migration aditiva)? | Sim. Sem ela, a checagem de chave repetida teria que varrer JSON. |
| D7 | Franquia de notas por plano (HANDOFF, "decisões abertas")? | Fora deste item. Deixar para a revisão de planos; o ponto de gancho é o início do `previewReceiptImport`. |
| D8 | O chat só aponta para a tela de importação, sem upload de foto no chat? | Sim. Upload no chat entra com o WhatsApp (item 5), onde a revisão é por link. |

## 12. Critério de pronto do item 4

- 4.0: relatório de medição aprovado pelo dono.
- 4a e 4b: `tsc`, `jest`, `nest build`, `ng test` e `npm run build` verdes (números reais colados); matriz da seção 10 coberta; mutantes mortos; integração real com duas contas; capturas no Chrome em tema claro e escuro, 360 px e desktop.
- Nenhuma chamada de rede e nenhum arquivo persistido durante a leitura (provado por teste e por inspeção na integração real).
- HANDOFF atualizado; merge na `master` só com aprovação do dono; versão e tag só depois do merge.
