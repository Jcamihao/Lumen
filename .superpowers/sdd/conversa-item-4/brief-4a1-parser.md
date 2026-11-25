# Brief 4a-1: parser puro de nota fiscal (subagente haiku)

Você implementa **só** o parser de texto de nota fiscal do projeto Lumen, com testes. Nada de biblioteca nova, banco, rede, controller, DTO ou migration. Responda e relate em caveman terse (português); código, comentários e commits em prosa normal.

## Antes de começar

- Repositório: `/home/caminhao/coding/codeStage/Lumen`. Branch de trabalho: `feature/importar-nota-fiscal` (confira com `git branch --show-current`; se for outra, pare e avise). Não troque de branch.
- Leia, nesta ordem: `.superpowers/sdd/conversa-item-4/contrato-tipos.md` (seção "Parte 4a-1", é o seu contrato: tipos, assinaturas, regras e textos de aviso) e a seção 6 de `docs/superpowers/specs/2026-11-16-conversa-contrato-item-4.md`.
- Protótipo de referência (descartável, NÃO copie cegamente; tem bugs conhecidos de primeira ocorrência da chave e usa `join('\n')` só em um caso): `.superpowers/sdd/conversa-item-4/spike/eval.js`, função `parseText`.
- Padrão de código e teste: veja `backend/src/imports/imports.upload-validation.spec.ts` e `backend/src/recurring-transactions/recurrence.util.ts` (datas em UTC).

## O que criar

1. `backend/src/imports/receipt-text.parser.ts`: tudo da seção "Parte 4a-1" do contrato (tipos, `RECEIPT_WARNINGS`, `parseReceiptText` e as 9 funções auxiliares exportadas).
2. `backend/src/imports/receipt-text.parser.spec.ts`: testes.

Não edite nenhum outro arquivo (nem `imports.service.ts`, nem `package.json`). Nenhuma dependência nova.

## Regras do projeto

- TypeScript do backend, aspas simples ou duplas como o arquivo vizinho; `strictNullChecks` está desligado, mas trate `null` explicitamente.
- Nada de `sed -i`, `perl -i` ou edição de arquivo por shell: use as ferramentas de edição. Nada de `sleep`.
- Dinheiro em centavos inteiros nas comparações (nunca comparar `number` decimal com `===`).
- Datas só com `Date.UTC` e getters `getUTC*`. Nunca `new Date(ano, mês, dia)`, `getDate()`, `getMonth()`, `setHours()` nem `new Date('2026-01-01')` sem hora.
- Expressão regular sem backtracking catastrófico; trunque o texto de entrada em 200.000 caracteres antes de processar.
- Nunca guardar nem devolver CPF. Nunca inventar item, total ou data que não esteja no texto.
- Comentário só onde o motivo não é óbvio, em português.

## Testes obrigatórios (cada linha é um teste que precisa falhar se a regra for removida)

Dados **sintéticos** apenas (nenhuma nota real; CNPJ e chaves gerados por você com DV correto, como em `spike/gen.js` funções `mod11`, `cnpj`, `chave`).

- `parseBrMoney`: `32,90`, `1.234,56`, `R$ 32,90`, `0,00`, `-5,00`, `1.000.000,01` (fora da faixa), `1.000.000,00` (aceito, é o limite), `32.90` (ambíguo, null), `1,234.56` (null), `abc`, vazio.
- `parseBrQuantity`: `1`, `0,350`, `1,000`, `0`, `1,2345` (null), `-1`.
- `parseBrDate` com `today` fixo: `05/03/2026`, `05/03/26`, `31/02/2026` (null), `01/01/1999` (null), data de amanhã (null), data de hoje (aceita), `29/02/2024` (aceita) e `29/02/2025` (null). O resultado é `Date.UTC` meia-noite (`getUTCHours() === 0`).
- `fixNumericOcr`: `O9`→`09`, `l5BS`→`1585`... (confira cada letra).
- Chave: DV certo, DV errado (troca um dígito), 43 e 45 dígitos, com espaços e quebras de linha, com `O` no lugar de `0` (recupera e valida), chave de 44 zeros e de 44 noves (recusadas: dígitos todos iguais).
- `decodeAccessKey`: campos corretos (UF, ano, mês, CNPJ, modelo, série, número); mês 13 devolve null.
- `isValidCnpj`: válido, DV errado, 14 zeros, 13 dígitos.
- `redactCpf`: `123.456.789-09` removido; `CPF: 12345678909` removido; `CPF 123.456.789-09 CONSUMIDOR` removido; chave de 44 dígitos e CNPJ ficam intactos; texto sem CPF fica igual.
- `sanitizeQrUrl` e `extractAccessKeyFromQr`: URL com `p=<chave>|2|1|1|HASH` devolve só host, caminho e `p`; parâmetros extras (`token=`, `cpf=`) somem; `javascript:alert(1)` e texto solto devolvem `null`; `p` com 43 dígitos ou DV inválido devolve `null` na extração.
- `parseReceiptText` (nota sintética completa, formato A): estabelecimento, CNPJ via chave, número, data, total, itens, soma batendo, sem `totalMismatch`, sem avisos.
- Formatos B e C de item; quantidade por peso (`0,350 KG x 17,50 6,13`).
- Soma: diverge por R$ 0,02 → `totalMismatch` preenchido com `difference` correta e sinal; diverge por R$ 0,01 → **não** preenchido; total maior que a soma (sinal positivo) e menor (negativo).
- Total: vários candidatos, um bate com a soma (escolhe o certo); nenhum bate (maior + `W_TOTAL_AMBIGUOUS`); linha `QTD. TOTAL DE ITENS 5` e `SUBTOTAL` ignoradas; sem total (`null` + `W_NO_TOTAL`).
- Chave do QR vs chave do texto: igual (sem aviso), diferente (usa QR + `W_KEY_CONFLICT`), QR inválida (usa a do texto), só QR (sem texto de chave).
- CNPJ: da chave vence o do texto; sem chave, do texto com `O` no lugar de `0` é recuperado; DV errado → `null` + `W_CNPJ_INVALID`.
- Data: duas datas no texto, a da linha com horário vence; data futura → `null` + `W_DATE_INVALID`; mês diferente da chave → mantém + `W_DATE_KEY_MISMATCH`.
- Linha de item que não fecha (2 × 10,00 ≠ 25,00) → `lineConsistent=false` e `W_ITEM_LINE(n)` com o número certo.
- Sem itens → `W_NO_ITEMS`, `itemsSum = null`.
- Privacidade: texto com CPF → `rawTextRedacted` não contém os dígitos do CPF e tem no máximo 500 caracteres; nenhum campo do resultado serializado (`JSON.stringify`) contém o CPF.
- Robustez: texto vazio, `"\u0000".repeat(1000)`, 100.000 caracteres de `9`, 100.000 de `-`: não lança e termina em menos de 500 ms.
- **Fuso:** rode a suíte com `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`; os resultados de data têm que ser iguais.

## Como verificar (cole os números reais no relatório)

```bash
cd /home/caminhao/coding/codeStage/Lumen/backend
npx tsc --noEmit -p tsconfig.json
npx jest src/imports/receipt-text.parser.spec.ts
TZ=America/Sao_Paulo npx jest src/imports/receipt-text.parser.spec.ts
TZ=Asia/Tokyo npx jest src/imports/receipt-text.parser.spec.ts
npx jest src/imports
```

Teste vermelho = não commitar.

## Mutantes (faça à mão, no arquivo, e desfaça; relate quais morreram)

Troque e rode a suíte: (1) `isValidAccessKeyDv` sempre `true`; (2) tolerância da soma de `> 1` para `>= 1` centavo; (3) remover a chamada de `redactCpf` em `rawTextRedacted`; (4) aceitar data futura; (5) remover o filtro de linhas `QTD`/`ITENS` do total; (6) remover o limite de R$ 1.000.000,00. Todos precisam derrubar pelo menos um teste. Mutante vivo = escreva o teste que o mata.

## Entrega

- Commit local com caminhos explícitos (os dois arquivos), mensagem `feat(imports): parser puro de texto de nota fiscal (item 4a-1)`, corpo curto em português, e a linha final `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Nunca `git add -A`, nunca amend/reset, nunca push. `index.lock` = esperar e repetir.
- Relatório final curto: arquivos, números dos testes (suítes e testes, três fusos), mutantes mortos/vivos, dúvidas. Dúvida de contrato vai para `.superpowers/sdd/conversa-item-4/duvidas.md` e para o relatório.
