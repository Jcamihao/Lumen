# Brief 4b: tela de importação de nota sem IA (subagente haiku, só frontend)

Você muda a tela de importação de nota fiscal do Lumen para o novo leitor local. Relate em caveman terse (português); código, comentários e commits em prosa normal. Só frontend: o backend está pronto e **não pode ser alterado**.

## Antes de começar

- Repositório `/home/caminhao/coding/codeStage/Lumen`, branch `feature/importar-nota-fiscal` (confira com `git branch --show-current`; outra = pare e avise).
- Leia: `docs/superpowers/specs/2026-11-16-conversa-contrato-item-4.md` (seção **8**, e 13 para as mensagens), os arquivos `frontend/src/app/features/imports/imports-page/imports-page.component.{ts,html,scss}`, `frontend/src/app/core/models/domain.models.ts` (tipo `ReceiptImportPreview`) e `frontend/src/app/core/services/life-api.service.ts` (`previewReceiptImport`, `commitReceiptImport`).
- Use `graphify query` antes de caçar com grep. Depois de mexer no código, `graphify update .` (nunca dois em paralelo).

## Contrato do backend (já em produção na branch)

Resposta da prévia (`POST /imports/receipts/preview`) ganhou estes campos, além dos que o tipo já tem:

| Campo | Tipo | Significado |
|---|---|---|
| `itemsSum` | `number \| null` | Soma dos itens lidos |
| `totalMismatch` | `{ itemsSum: number; total: number; difference: number } \| null` | Preenchido quando a soma dos itens difere do total (tolerância de 1 centavo) |
| `extraction` | `{ method: 'PDF_TEXT' \| 'OCR'; ocrConfidence: number \| null; warnings: string[]; qrDetected: boolean; secondPass: boolean } \| null` | `warnings` já são frases prontas em português; `null` em nota antiga |
| `accessKeyValid` | `boolean` | Chave de acesso passou no dígito verificador |
| `confidence` | `'low' \| 'medium' \| 'high'` | Calculada pelo servidor; `low` = divergência, nenhum item ou linha de item inconsistente |

`possibleDuplicate`, `duplicateTransactionId` e `duplicateTransactionDescription` já existiam; agora `possibleDuplicate` também fica `true` quando a **chave de acesso** já foi importada pelo mesmo usuário.

Commit (`POST /imports/receipts/commit`) ganhou o campo opcional `acknowledgeDuplicate?: boolean`. Sem ele, se a nota for duplicata o servidor responde **409** com `{ statusCode: 409, code: 'RECEIPT_DUPLICATE_UNCONFIRMED', message: 'Parece que você já lançou esta compra. Confirme para importar mesmo assim.' }`. Com `true` grava normalmente.

Erros do preview (o corpo sempre tem `message` pronta para exibir; o front lê `error.error.message` e `error.error.code`):

| HTTP | `code` | Quando |
|---|---|---|
| 422 | `RECEIPT_UNREADABLE` | Sem total confiável; mensagem manda lançar pelo chat ou pela tela de Finanças |
| 429 | `RECEIPT_BUSY` | Muitas leituras ao mesmo tempo; "tente em instantes" |
| 400 | (sem code) | HEIC, PDF digitalizado, imagem grande demais, arquivo ilegível; mensagem pronta |

O upload de nota **não depende mais** de consentimento de IA: o servidor não chama o Selah neste fluxo.

## O que fazer (seção 8 do contrato)

1. **Tipos e serviço:** em `domain.models.ts` adicione os campos novos a `ReceiptImportPreview` (`itemsSum`, `totalMismatch`, `extraction`, `accessKeyValid`; mantenha opcionais onde nota antiga pode não ter). Em `life-api.service.ts` adicione `acknowledgeDuplicate?: boolean` ao payload de `commitReceiptImport`.
2. **Remover o portão de IA do fluxo de nota:** o upload da nota aparece sempre. Tire o `*ngIf="canUseReceiptAi(); else aiDisabled"`, o bloco `aiDisabled` ("IA externa desativada") e a etiqueta "IA ativa / IA indisponível" do bloco de nota. Se `canUseReceiptAi` ficar sem uso, remova-o. Troque textos que digam "SelahIA" ou "IA" no fluxo de nota por "leitura local" (por exemplo a mensagem padrão de erro `'Nao foi possivel ler a nota fiscal com o SelahIA.'` vira `'Não consegui ler esta nota. Tente outra foto ou lance o gasto pelo chat.'`). **Não mexa** no fluxo de CSV.
3. **Divergência de soma:** quando `totalMismatch` vier preenchido, mostre no topo da prévia, com destaque (use as classes de aviso que a tela já tem, sem cor nova), o texto `A soma dos itens (R$ X) é diferente do total da nota (R$ Y).` com X = `totalMismatch.itemsSum` e Y = `totalMismatch.total`, formatados em moeda BRL como o resto da tela. O botão de confirmar continua habilitado. O aviso não some ao clicar em nada: só some se o usuário editar os itens ou o total e a divergência deixar de existir no cálculo local (recalcule no cliente a soma dos itens editados contra o total editado, tolerância de 1 centavo, e esconda o aviso quando bater).
4. **Avisos e confiança:** liste `extraction.warnings` (uma linha cada) acima dos itens. Quando `confidence === 'low'`, mostre `Leitura incerta, confira cada linha.`. Quando `confidence === 'high'` não mostre aviso extra.
5. **Duplicata:** troque o aviso atual de duplicata por uma caixa de decisão com o título `Parece que você já lançou esta compra`, a `duplicateTransactionDescription` quando existir, e o botão principal passa a se chamar `Importar mesmo assim` (nos demais casos continua o texto atual). O front só envia `acknowledgeDuplicate: true` depois que o usuário clica nesse botão com a caixa visível. Se o commit voltar 409 com `code === 'RECEIPT_DUPLICATE_UNCONFIRMED'` mesmo sem `possibleDuplicate` na prévia (chave importada no meio-tempo), abra a mesma caixa em vez de mostrar erro, e deixe o usuário decidir. Nunca envie `acknowledgeDuplicate: true` por padrão.
6. **Erros do preview:** 422, 429 e 400 mostram `error.error.message` do servidor no lugar atual de `receiptError`; sem `message`, use o texto padrão do item 2. Não deixe a prévia anterior na tela depois de um erro novo.
7. **Bloco "Leitura Selah da compra":** continua condicional (só quando houver resumo, sinais ou ações). Troque o título para `Resumo da compra`.
8. Tema claro e escuro e 360 px como estão. **Sem cor, fonte, ícone ou componente novo**: reutilize as classes existentes (`proto-*`). Se uma classe de aviso não existir, reutilize a mais próxima já usada na tela e relate.

## Testes (obrigatórios, cada linha precisa falhar se a regra for removida)

Crie `imports-page.component.spec.ts` se não existir (veja como `assistant-page.component.spec.ts` monta o componente com `TestBed`, serviços simulados e `provideRouter`). Cobertura mínima:
- upload de nota aparece com usuário **sem** consentimento de IA e não aparece "IA externa desativada";
- `totalMismatch` preenchido mostra o aviso com os dois valores; botão de confirmar continua habilitado; editar item até a soma bater esconde o aviso;
- `extraction.warnings` listados; `confidence: 'low'` mostra "Leitura incerta, confira cada linha."; `high` não mostra;
- `possibleDuplicate: true` mostra a caixa e o botão "Importar mesmo assim"; clicar chama `commitReceiptImport` com `acknowledgeDuplicate: true`; sem duplicata o commit **não** leva `acknowledgeDuplicate` verdadeiro;
- commit com erro 409 `RECEIPT_DUPLICATE_UNCONFIRMED` abre a caixa e não mostra toast de erro genérico;
- preview com 422, com 429 e com 400: mostra a `message` do servidor e limpa a prévia anterior;
- nota antiga (sem `extraction`, `itemsSum`, `totalMismatch`, `accessKeyValid`) renderiza sem erro;
- título `Resumo da compra` quando há sinais.

## Como verificar (cole números reais no relatório)

```bash
cd /home/caminhao/coding/codeStage/Lumen/frontend
npx tsc --noEmit -p tsconfig.app.json
npx ng test --watch=false --browsers=ChromeHeadless     # confira em package.json o comando de teste usado no projeto
npm run build
```

Teste vermelho = não commitar. Se o Chrome não abrir, relate; não troque de ferramenta de teste.

## Regras

- Só os arquivos de `frontend/src/app/features/imports/`, `domain.models.ts`, `life-api.service.ts` e seus specs. Nada de dependência nova, nada no backend, nada em `package.json`.
- Nada de `sed -i`, `perl -i`, `python` ou edição por shell (use as ferramentas de edição); nada de `sleep`; nada de rodar mais de 2 processos de teste ao mesmo tempo (a máquina já reiniciou com carga).
- Comentário só onde o motivo não é óbvio, em português. Strings da UI em português correto com acentos.
- Um commit, caminhos explícitos: `feat(imports): tela de nota sem IA, aviso de divergência e decisão de duplicata (item 4b)`, corpo em português, linha final `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Nunca `git add -A`, amend, reset ou push. `index.lock` = esperar e repetir.

## Relatório final (chat, curto)

Arquivos, números reais (tsc, ng test, build), o que ficou sem teste, dúvidas de contrato (registre também em `.superpowers/sdd/conversa-item-4/duvidas.md`), hash do commit.
