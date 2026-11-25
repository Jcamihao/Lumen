# Resultado da revisao 12.0b-2 (tom das mensagens e ensino)

Data: 2026-11-25. Revisor: Claude Sonnet 5.5. Modo leve por pedido do dono (sem Docker, sem backend, jest com nice e maxWorkers=1).

## Veredito: GO

Nenhum defeito objetivo no codigo de tom. Dois achados corrigidos (texto fixo de adaptadores; cobertura de teste).

## Revisao adversarial (spec temporario, removido): 300 sementes x 12 descricoes
- Despesa nunca alegre: recibo e rascunho, com e sem cartao, categoria 'Lazer'. Nenhum emoji de festa, nenhuma frase alegre. OK.
- Receita/despesa: no maximo 1 emoji; dados (descricao, valor) sempre no texto, inclusive com '$&', '$\'', '$1', '{total}', HTML, emoji e 120 caracteres. Interpolacao em passada unica com funcao: sem expansao. OK.
- Sensivel vira neutro (descricao e categoria) para funeral, velorio, luto, multa, divida, remedio, hospital, cirurgia, enterro, saude (com e sem acento, caixa alta). OK.
- Variante deterministica: mesmo seed, mesmo indice. Distribuicao em 300 sementes: 110/95/95. Semente vem do messageId que abriu o rascunho e fica no rascunho: botao (messageId nulo) e mensagens seguintes nao trocam o tom. OK.
- Parcelado e guardar: sem emoji (parcelado), no maximo 1 (guardar), titulo e descricao no texto. Recibo do parcelado nao depende de agregacao. OK.
- Marcador 'Responda "confirmar" ou "cancelar".' preservado no rascunho (lancamento, aporte); formatador Telegram usa o marcador para nao duplicar linhas; escapeHtml cobre o texto inteiro. Confirmado por teste e mutante.
- Frontend nao depende dos textos antigos ('Registrado', 'Rascunho de').
- Ensino: todos os exemplos entre aspas de ajuda, amountMissing, tres textos de fallback de IA e exemplos do menu casam no matchIntent (so 'menu' e palavra de controle do motor).
- Palavras sensiveis x inocentes: casam (viram neutro, inofensivo): multado, dividir, dividido, exames, medicina, plano de saude. NAO casam: multiplicar, examinar, comedic, saudade, saudavel, lutador.

## Achados e correcoes
1. Adaptadores Telegram/WhatsApp (linked, empty) e receipt-extractor (2 mensagens) ainda ensinavam "50 mercado". Trocado por "gastei 50 no mercado" (commit 1f0af7c, so texto fixo). Teste novo teaching-texts.spec.ts.
2. Mutantes sobreviventes (radical removido, radical no meio da palavra): cobertos por teste por radical e casos de meio de palavra (commit seguinte).
3. Flakes: isolation.spec.ts 5x seguidas + specs de tom e menu: 5/5 verdes (235 testes por rodada). Nenhum outro teste depende de UUID/messageId aleatorio com variante de tom (busca por frases de tom fora dos specs de tom: nada).

## Textos reais recebidos
Nao ha textos de integracao real (ver NAO verificado). Textos produzidos pelo codigo, conferidos em teste: recibo do parcelado seed 'a': "Pronto: celular em 10x, total R$ 1.500,00, registrado."; demais variantes em textos-de-tom.md.

## Mutantes (12 + reexecucao)
Mortos 12/12 ao fim. Sobreviveram na 1a rodada: 3 (radical 'funer' removido) e 4 (startsWith -> includes); cobertos e mortos. Mortos de inicio: despesa ALEGRE, sensivel sem neutro, emoji extra no neutro, marcador de confirmacao removido, escape do Telegram removido, recibo ignora semente, recibo ignora categoria sensivel, hash aleatorio, placeholder sem erro, cartao some do recibo. Equivalentes: nenhum. Arquivos restaurados (git status limpo).

## Numeros (2026-11-25, Sonnet 5.5)
- tsc --noEmit: sem erro.
- Specs tocados (tone, replies.tone, menu, parsers, telegram, whatsapp adapter/format, receipt-extractor): UTC e Asia/Tokyo verdes.
- Tom + isolation + menu 5x UTC: 5/5; Tokyo 134 verdes.
- Suite inteira UTC maxWorkers=1: 104 suites, 3320 testes verdes.

## Duvidas de produto (nao decidi)
- Lista de radicais nao inclui: morte, falecimento, cemiterio, heranca, pensao, acidente, indenizacao, demissao, rescisao, psicologo, terapia, veterinario, aborto. Receita 'indenizacao de acidente' ou 'heranca' sai alegre. Ampliar a lista?
- Parcelado nao e alegre mas "total R$ x" repete dados; gosto do dono.

## NAO verificado
- Integracao Docker (Postgres/Redis, contas A/B/C, 100 confirmacoes concorrentes, Telegram com Bot API falsa): nao rodada por pedido do dono (WSL sobrecarregado). Concorrencia e isolamento so por testes unitarios existentes.
- Suite inteira em America/Sao_Paulo e Asia/Tokyo; so specs tocados em Tokyo.
- Specs 30x: feito 5x por pedido.
- Gosto dos textos de tom: do dono.
