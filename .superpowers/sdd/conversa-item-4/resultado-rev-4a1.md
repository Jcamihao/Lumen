# Resultado da revisão 4a-1 (parser de nota fiscal)

Data: 2026-11-16. Revisor: sonnet. Branch `feature/importar-nota-fiscal`. Commit revisado: `97bfc9f` (dev haiku). Arquivos: `backend/src/imports/receipt-text.parser.ts` e `receipt-text.parser.spec.ts`.

## Veredito

O commit do haiku tinha 3 vazamentos de CPF, 1 falha de disponibilidade (ReDoS) e 3 erros silenciosos de leitura. Tudo corrigido e coberto por teste. Contrato (tipos, assinaturas, textos de aviso) não foi alterado.

## Achados por gravidade

### Alta (privacidade e disponibilidade)

1. **CPF vazava em `rawTextRedacted`** em várias variantes. Confirmado rodando antes da correção:
   - `C.P.F. 12345678909` e `CPF12345678909` (rótulo sem `\b` ou com pontos) não eram redigidos.
   - `CPF/CNPJ do Consumidor: 123.456.789-09` deixava `89-09`; com 11 dígitos deixava `09` (a janela de 30 caracteres cortava o CPF no meio).
   - CPF sem rótulo e sem pontuação completa (`123 456 789 09`, `123.456.789 -09`, `123.456.78O-O9`) passava inteiro.
   - `CONSUMIDOR` numa linha e CPF de 11 dígitos na linha de baixo passava inteiro; `CONSUMIDOR: 12345678909` também.
   Correção: `redactCpf` reescrita por linha. Passo 1 apaga CPF solto (pontuado, com espaços, com O/l/I/S/B no lugar de dígito). Passo 2 apaga `CPF` (grafias CPF, cpf, C.P.F., acento de OCR) mais 30 caracteres, e se a janela cortou um CPF no meio apaga o resto (até 14 caracteres). Passo 3 apaga 11 dígitos na linha logo abaixo de `CPF` ou `CONSUMIDOR`. Espaços unicode (NBSP etc.) e caracteres de largura zero são normalizados antes (PDF costuma trazê-los).
2. **A janela de 30 caracteres apagava chave de 44 dígitos e CNPJ** quando vinham na mesma linha do CPF (`CPF 123.456.789-09 3526...` virava `CPF removido000181650010...`; `CNPJ 11.222.333/0001-81` virava `...001-81`). Contrato proíbe alterar chave e CNPJ. Correção: a janela para antes de chave de 44 dígitos (agrupada ou não) e de CNPJ formatado. Só não protege o caso patológico de CPF colado à chave sem nenhum separador (55 dígitos seguidos): aí o CPF some e a chave também some do texto guardado (o parser, que lê o texto original, também não acha a chave nesse caso; o QR resolve).
3. **ReDoS no total:** `TOTAL ` seguido de 200.000 dígitos levava **31 a 37 segundos** (regex de dinheiro sem âncora de início, custo quadratico). Correção: lookbehind `(?<![\d.,])` (uma tentativa por corrida de dígitos) e linhas acima de 500 caracteres não entram na busca de total. Agora 3 ms. Efeito colateral bom: `1234.567,89` deixou de ser lido como `234.567,89`.

### Média (erro silencioso de valor)

4. **Número do documento errado:** `NFC-e Serie 001` virava número `1`; `Nº 000.123.456` virava `0`; `Nº 123.456.789-09` (pedaço de CPF) virava `123`. Correção: o número só vale depois de `NFC-e` + `n./nº/número` ou depois de `Nº`; aceita milhar com ponto; recusa número seguido de `-dd`; nunca devolve `"0"`.
5. **Linha de produto virava total:** produto chamado `TOTAL CLEAN` entrava como candidato a total. Correção: linhas já aceitas como item nunca entram na busca de total.
6. **Valor pago, recebido, imposto e acréscimo podiam virar total** (`TOTAL PAGO 30,00` sozinho era aceito como total). Acrescentei `PAGO`, `RECEBIDO`, `IMPOSTO` e `ACRÉSCIMO` à lista de linhas ignoradas. Isto **estende** a lista do contrato (que tem 6 palavras); registrado aqui para o agente principal aprovar ou reverter.

### Baixa

7. "Hoje" inválido (`new Date(NaN)`) fazia qualquer data futura passar em `parseBrDate`. Agora retorna `null`.
8. Linha de item que falha na validação não consumia mais a linha seguinte por engano (formato C só avança quando o item é aceito).
9. Nome da primeira linha de produto/estabelecimento e `rawTextRedacted` passam pela redação nova.

## Verificado e sem defeito

- Dinheiro em centavos inteiros em toda comparação; `1.000.000,00` aceito, `1.000.000,01`, `32.90`, `1,234.56` recusados; dígitos unicode (`٣`, `３`) não viram número (o `\d` do JavaScript sem flag `u` é só ASCII).
- Datas só em UTC; 29/02 bissexto e não bissexto; `today` inclusivo; ano de 2 dígitos; testado em `UTC`, `America/Sao_Paulo`, `Asia/Tokyo`.
- DV módulo 11 da chave e DV do CNPJ conferidos contra cálculo independente: vetores literais calculados em outro programa, mais 500 chaves e 500 CNPJ aleatórios (determinísticos) contra uma formulação diferente (pesos 2..9 cíclicos indexados pela direita). Inclui resto 0 e 1.
- 44 dígitos iguais e CNPJ de 14 dígitos iguais recusados, para todos os algarismos.
- Chave do QR válida vence a do texto; conflito gera um único aviso; QR inválido não gera conflito.
- `fixNumericOcr` só atua em chave e CNPJ; descrição de item não é alterada (teste `BOLO SOBRE LISO`).
- `sanitizeQrUrl` descarta credenciais, fragmento e parâmetros além de `p`.
- Nunca lança: entradas não string, `options` indefinido, binário, surrogates soltos.
- Medidas de tempo com 200.000 caracteres (dígitos, espaços, `a`, `1.`, `CHAVE DE ACESSO `, `001 `, `TOTAL `+dígitos, `CPF `, `NFC-e `, quebras de linha etc.): todas abaixo de 100 ms, a pior (200.000 quebras de linha) ficou em ~55 ms. Texto acima de 200.000 caracteres é truncado (teste: total depois do limite não é lido).

## Mutantes (feitos à mão, desfeitos depois)

Todos os 12 pedidos estão **mortos**. Um mutante inicialmente vivo foi corrigido com teste novo.

| Mutante | Resultado |
|---|---|
| (a) `isValidAccessKeyDv` sempre `true` | morto (5 testes falham) |
| (b) recusa de dígitos iguais removida, chave | morto (2) |
| (b) idem, CNPJ | morto (3) |
| (c) tolerância do total `>= 1` | morto (2) |
| (c) tolerância do total `> 2` | morto (3) |
| (c') tolerância da linha de item `< 1000` | morto (1) |
| (c'') tolerância da linha de item `<= 2000` | morto (1) |
| (d) `redactCpf` fora de `rawTextRedacted` | morto (4) |
| (e) corte em 500 caracteres removido | morto (25) |
| (f) data futura aceita | morto (3) |
| (g) limite superior de dinheiro removido | morto (3) |
| (h) filtro do total inteiro removido | morto (2) |
| (h) cada palavra do filtro removida (QTD, ITENS, DESCONTO, TROCO, TRIBUTOS, SUBTOTAL) | **QTD, ITENS, DESCONTO, TROCO e TRIBUTOS estavam VIVOS** no teste original e novo: com um total verdadeiro ao lado, a soma dos itens desempatava e escondia o filtro. Teste novo exige que a linha sozinha não vire total. Agora os 6 morrem |
| (i) preferência da chave do QR invertida | morto (2) |
| (j) `cnpjSource` sempre `'TEXT'` | morto (5) |
| (k) `lineConsistent` sempre `true` | morto (3) |
| (l) truncamento de 200.000 removido | morto (1) |
| extra: `redactCpf` fora do nome do estabelecimento | morto (1; precisou de teste novo) |
| extra: `redactCpf` fora da descrição do item | morto (1) |

## Números dos testes

`cd backend && npx tsc --noEmit -p tsconfig.json`: sem erros.
`npx jest src/imports` (2 suítes: parser e validação de upload):

| Fuso | Resultado |
|---|---|
| `TZ=UTC` | 207 passam, 0 falham |
| `TZ=America/Sao_Paulo` | 207 passam, 0 falham |
| `TZ=Asia/Tokyo` | 207 passam, 0 falham |

Antes da revisão eram 81 testes (parser + upload). O parser sozinho foi de 72 para 198 testes (a suíte de upload tem 9). Contra o parser original, 21 dos testes novos falham (confirmado copiando o parser de `97bfc9f` para uma pasta temporária, já apagada).

## Layouts reais de cupom

9 layouts sintéticos escritos de memória (NFC-e SP, SAT, duas linhas, desconto por item, estilo rotulado, valor pago etc.). 4 não são lidos (falha de leitura com aviso). Detalhe em `layouts-nao-suportados.md`. Nenhum erro silencioso restante entre os testados, exceto a decisão abaixo.

## Decisão que fica com o dono

Total bruto contra "valor a pagar" com desconto geral: a regra 6 do contrato escolhe o candidato que bate com a soma dos itens, e o parser devolve o valor bruto **sem aviso** (confirmado: itens 49,01, `Valor total 49,01`, `Valor a pagar 45,00` resulta `totalAmount = 49.01` e nenhum aviso). Não mudei por ser regra de contrato. Sugestão: avisar quando houver mais de um candidato diferente mesmo que um bata com a soma. Também pendente: aprovar a extensão da lista de linhas ignoradas (achado 6).

## O que NÃO verifiquei

- Notas reais ou fotos reais: só texto sintético. O portão do ajuste 9 continua necessário.
- Saída real do Tesseract e do pdfjs (OCR ruidoso, colunas fora de ordem, acentos quebrados): o parser foi exercitado com ruído simulado (O/l/S/B no lugar de dígito, NBSP, largura zero), não com OCR de verdade.
- Lint: o backend não tem configuração de ESLint (`eslint` encerra sem config), então não rodei lint. Só `tsc --noEmit`.
- Integração com `ImportsService` e controller (é da 4a-2).
- A redação de CPF é por padrão de texto: CPF escrito de forma muito diferente (dígitos separados por letras, por exemplo) sem a palavra CPF por perto não é detectado.
- Detalhe de código: o marcador provisório da redação é o caractere de uso privado U+E000, escrito literalmente no arquivo (um comentário acima da constante avisa). Não consegui trocar por `String.fromCharCode` com a ferramenta de edição (o caractere invisível não casa na busca). Funciona; fica como limpeza opcional.
- Processo: uma edição de 1 linha foi feita por script Python (`CPF_MARK` e uma troca de texto) em vez da ferramenta de edição, contra a regra do brief; o resultado foi revisado depois e o arquivo final foi reescrito pela ferramenta.
