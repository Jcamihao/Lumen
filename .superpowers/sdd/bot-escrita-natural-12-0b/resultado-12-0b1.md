# Resultado 12.0b-1: escrita natural (matcher)

Data: 2026-11-25. Branch feat/bot-escrita-natural-12-0b. Executor: Claude Haiku 5.5 (agente unico, sem subagentes).
Contrato: docs/superpowers/specs/2026-11-25-conversa-contrato-item-12-0b.md (secoes 2 e 4). Tom (12.0b-2) nao foi tocado.

## Mudancas
- backend/src/conversation/parsers/write-natural.ts (novo): tabelas de verbos informais por tipo, palavras de
  enchimento, destino do aporte e parcelado "em Nx de V" convertido em total para o caminho existente.
- intent.matcher.ts: chama matchNaturalWrite antes de receita/despesa; "?" bloqueia receita/despesa com valor;
  "criar/nova caixinha", "minhas caixinhas", "caixinhas" e "apagar/editar caixinha" entram nas tabelas de meta.
- amount.parser.ts: "conto"/"contos" logo depois do valor sai do resto do texto.
- goal.parser.ts: "caixinha" entra nas palavras de ligacao do aporte.
- Testes: write-natural.spec.ts (positivos por tipo, negativos, regras de forma), linhas novas em
  amount.parser.spec.ts, goal.parser.spec.ts e um teste de servico em conversation.service.spec.ts (receita e despesa viram rascunho).

## Comandos e numeros (2026-11-25)
- npx tsc --noEmit: EXIT=0.
- npx jest src/conversation/parsers: 13 suites, 982 verdes (antes do teste de servico); depois, parsers + servico: 1266 verdes.
- src/conversation, src/telegram, src/whatsapp (42 suites): TZ=UTC, America/Sao_Paulo e Asia/Tokyo: 1937 verdes em cada fuso.
- Suite inteira (TZ=UTC, --maxWorkers=2): 100 suites, 3203 testes verdes.
- write-natural.spec.ts + amount + goal, 15 execucoes seguidas: 168 verdes em todas.
- graphify update . (raiz do worktree): ok, 6899 nos, 375 comunidades.
- eslint: sem configuracao no projeto (nao rodou). prettier: arquivos de origem ja falhavam no HEAD (intent.matcher.ts); nao reformatei.

## Mutantes (22 injetados, alvo: write-natural.ts, intent.matcher.ts, goal.parser.ts, amount.parser.ts)
- Mortos: 22. Sobreviventes na primeira rodada: 2 (limite de caracteres; verbo em qualquer posicao).
  Cobertos com "hoje 500 do freela caiu" e frase de 500+ caracteres; apos isso, mortos.
- Equivalentes: nenhum identificado.
- Lista: limite de palavras; limite de caracteres; "?" no natural; filler; destino do aporte; formato de centavos;
  total do parcelado (x N); artigos; "parcela" de fim; prefixo de verbo; "me pagaram"; conectores; "poupei";
  "parcelei"; chamada do natural no matcher; "?" em receita; "?" em despesa; caixinha em editar/apagar,
  criar e listar; caixinha como palavra de ligacao; "conto".

## Decisoes e desvios (ver duvidas.md)
- "guardei 200" continua fora (teste existente). "poupei 80" tambem fica fora (sem destino).
- "gastei ...?" agora nao grava (mudanca em verbo antigo).

## NAO verificado
- Fluxo completo no Telegram/WhatsApp e rascunho -> confirmar -> 1 registro: nao rodado (sem Docker nesta fatia, conforme brief).
- Parcelado natural ponta a ponta (rascunho de parcelado com total e 10 parcelas): so o corpo foi testado; o servico de parcelado existente nao foi exercitado com essas frases.
- Aporte natural ponta a ponta (contribuicao gravada): so o matcher e o corpo foram testados.
- Textos de tom e ajuda: fora do escopo (12.0b-2).
- Percepcao do dono sobre as frases: duvidas.md.
