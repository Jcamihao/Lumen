# Brief de revisão e correção 4a-1: parser de nota fiscal (subagente sonnet, obrigatório)

Você revisa e CORRIGE o parser puro de nota fiscal do Lumen. Item de segurança e dado pessoal (CPF, chave fiscal): o rigor é obrigatório. Relate em caveman terse (português); código, comentários e commits em prosa normal.

## Contexto

- Repositório: `/home/caminhao/coding/codeStage/Lumen`, branch `feature/importar-nota-fiscal` (confira com `git branch --show-current`; outra = pare e avise). Commit a revisar: `97bfc9f` (dois arquivos: `backend/src/imports/receipt-text.parser.ts` e `receipt-text.parser.spec.ts`), feito por um dev haiku.
- Contrato: `.superpowers/sdd/conversa-item-4/contrato-tipos.md` (seção "Parte 4a-1") e seção 6 de `docs/superpowers/specs/2026-11-16-conversa-contrato-item-4.md`. Brief do dev: `.superpowers/sdd/conversa-item-4/brief-4a1-parser.md`. Dúvidas do dev: `.superpowers/sdd/conversa-item-4/duvidas.md` (5 itens; o agente principal já aceitou: nome do estabelecimento por heurística da primeira linha, data ausente gera `W_DATE_INVALID`, `W_ITEM_LINE(n)` numera pela posição na lista, redação de CPF apaga até 30 caracteres depois de "CPF", 11 auxiliares exportadas).
- O parser lê texto vindo de OCR de foto de cupom térmico e de PDF. A entrada é hostil e ruidosa.

## O que fazer

1. Ler o diff inteiro (`git show 97bfc9f`), os dois arquivos completos e o contrato. Comparar regra por regra com o contrato; qualquer divergência é bug do código (ou do teste), corrija.
2. Rodar: `cd backend && npx tsc --noEmit -p tsconfig.json`, `npx jest src/imports` e a suíte do parser em `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`. Colar os números reais.
3. **Privacidade (foco principal):** tentar fazer o CPF vazar em `rawTextRedacted` e em qualquer campo de `parseReceiptText`. Variantes obrigatórias: `123.456.789-09`, `12345678909` depois de `CPF`, `CPF/CNPJ: 123.456.789-09`, `CPF: 123 456 789 09`, `CPF 123.456.789 -09`, `C.P.F.`, `CPF` em minúsculas e com acento de OCR, CPF mascarado (`***.456.789-**`; o que sobra de um mascarado não identifica ninguém, mas não pode quebrar a regra), CPF em linha separada do rótulo (`CONSUMIDOR` na linha, CPF na linha seguinte), CPF colado a uma chave de 44 dígitos, CPF com dígitos 0/O trocados pelo OCR. Também: a redação não pode apagar a chave de 44 dígitos nem o CNPJ nem o total. Achou vazamento = corrija e escreva o teste.
4. **Robustez e ReDoS:** conferir toda expressão regular. Procurar quantificadores aninhados e alternâncias sobrepostas. Testar entradas patológicas (100.000 a 200.000 caracteres de dígitos, de espaços, de `a`, de `1.` repetido, de `CHAVE DE ACESSO ` repetido, de linhas `001 ` repetidas) e medir o tempo; tudo abaixo de 500 ms. Texto acima de 200.000 caracteres é truncado antes de processar. Nunca pode lançar exceção.
5. **Corretude de dinheiro e data:** centavos inteiros em toda comparação; sem `===` entre decimais; `1.000.000,00` aceito e `1.000.000,01` recusado; `32.90` e `1,234.56` recusados; datas só UTC; 29/02 de ano bissexto e não bissexto; `today` limite inclusivo; dígito unicode (por exemplo `٣` ou `３`) não pode virar número.
6. **Chave e CNPJ:** DV módulo 11 da chave e DV do CNPJ conferidos contra um cálculo independente (escreva o cálculo no teste, não reuse a função testada); 44 dígitos iguais recusados; CNPJ de 14 dígitos iguais recusado; chave do QR válida vence a do texto; conflito gera aviso; `fixNumericOcr` não pode ser aplicado a descrição de item.
7. **Layouts reais de cupom:** escreva em um teste novo 4 a 5 textos SINTÉTICOS no estilo de DANFE NFC-e e de cupom de supermercado que você conheça (cabeçalho com razão social, CNPJ, linha de item com código EAN longo de 13 dígitos, item com desconto, total, forma de pagamento, tributos, chave em duas linhas, QR, protocolo, CPF do consumidor). Veja quais o parser lê certo e quais falha. O que for falha **de leitura** (item não reconhecido) NÃO é bug a corrigir agora: liste em `.superpowers/sdd/conversa-item-4/layouts-nao-suportados.md` com o texto da linha e o motivo, porque isso decide o portão com notas reais. O que for **erro silencioso** (valor errado aceito sem aviso, por exemplo pegar "TOTAL DE TRIBUTOS" ou o valor pago como total, o EAN como quantidade, o troco como item) É bug: corrija.
8. **Mutantes** (à mão, desfazendo depois; relate vivos e mortos; mutante vivo = escreva o teste que o mata): (a) `isValidAccessKeyDv` sempre `true`; (b) recusa de dígitos todos iguais removida na chave e no CNPJ; (c) tolerância `> 1` centavo trocada por `>= 1` e por `> 2`; (d) `redactCpf` fora de `rawTextRedacted`; (e) corte em 500 caracteres removido; (f) data futura aceita; (g) limite superior de dinheiro removido; (h) filtro de linhas `QTD`/`ITENS`/`DESCONTO`/`TROCO`/`TRIBUTOS`/`SUBTOTAL` do total removido; (i) preferência da chave do QR invertida; (j) `cnpjSource` sempre `'TEXT'`; (k) `lineConsistent` sempre `true`; (l) truncamento de 200.000 caracteres removido.

## Regras

- Pode editar só `receipt-text.parser.ts`, `receipt-text.parser.spec.ts` e criar `layouts-nao-suportados.md` e `resultado-rev-4a1.md` em `.superpowers/sdd/conversa-item-4/`. Nada de dependência nova, nada fora disso.
- Nada de `sed -i`, `perl -i` ou edição de arquivo por shell (use as ferramentas de edição) e nada de `sleep`. Dados sintéticos apenas, nunca nota ou CPF real.
- Não mude o contrato (tipos, assinaturas, textos de aviso). Se achar que o contrato está errado, registre em `duvidas.md` e relate; não decida sozinho.
- Teste vermelho = não commitar. Commit com caminhos explícitos, mensagem `fix(imports): revisão do parser de nota fiscal (item 4a-1)` (ou `test(imports):` se só testes), corpo em português listando o que mudou, linha final `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Nunca `git add -A`, amend, reset ou push.
- Escreva `resultado-rev-4a1.md` (prosa normal): achados por gravidade, o que corrigiu, mutantes vivos/mortos, números dos testes nos três fusos, o que **não** verificou.

## Relatório final (chat, curto)

Achados corrigidos, achados não corrigidos (com motivo), números reais de teste, mutantes, layouts não suportados (contagem), hash do commit.
