# Retomada da revisão do 3b2b (leia junto com `revisao.md`)

Data: 2026-11-16. Para o subagente de revisão e correção (sonnet). Relatório final em estilo curto. Código, comentários e documentos persistidos em português do Brasil, prosa normal.

`revisao.md` desta pasta é o roteiro completo (pontos a exercitar, checklist A a G, 12 grupos de mutantes, integração real, limpeza, relatório). Este arquivo diz **o que o revisor anterior já fez** e **o que falta**. O revisor anterior foi interrompido pelo dono no meio da integração.

## Estado da árvore

O 3b2b está commitado (HEAD `4e02e49`, commits `7c411f2`, `d6318ad`, `4762a30`). A árvore está limpa, exceto `.log` antigos (ficam FORA de commits). Conferido pelo agente principal: `tsc` limpo, backend 47 suites / 1162 testes, `nest build` ok, módulos conversation + recurring-transactions + installments em 607 testes nos fusos UTC, America/Sao_Paulo e Asia/Tokyo, frontend 270 testes e build ok.

## Já feito pelo revisor anterior (aproveite, não refaça sem motivo)

- **Teste intermitente achado e corrigido:** `evento não guarda a descrição nem o valor` (conta fixa) falhava em ~2 de 30 execuções porque o UUID aleatório do evento às vezes continha "120". Corrigido ignorando `id`, `messageId` e `appliedKey` na serialização. Agente principal rodou o spec do motor 30 vezes sem falha. Procure se há outro teste que procure número curto em JSON com UUID (já verificado: linhas ~1034, 1056, 1068, 2220, 2728 do spec do motor).
- **Integração real parcial** (Postgres e Redis descartáveis, já removidos): cenários A a E em `/tmp/claude-1001/-home-caminhao-coding/bd9c9413-cf71-4265-8b29-e861b90c2685/scratchpad/r3b2b/integ/` (`scn_a.js` ... `scn_e.js` com as saídas `scn_*.out`), lote de parser em `../parser-batch.{js,out}`. Leia as saídas para saber o que foi coberto. Os containers foram apagados: para repetir qualquer cenário, suba novos, descartáveis.
- Verificações de `tsc`, `jest` completo e build já registradas em `../tsc.log`, `../jest-full.log`, `../build.log`.

## O que FALTA (nesta ordem)

1. Ler `revisao.md`, o contrato `docs/superpowers/specs/2026-11-15-conversa-contrato-item-3b2.md` (seções 4 e 5), `contrato-tipos.md`, `duvidas.md`, e o diff do 3b2b (`git diff 21fc3b1..HEAD -- backend frontend`). Sem se apoiar em relatório de outro agente: leia o código.
2. **Mutantes** (grupos do `revisao.md`): aplicar, rodar o módulo afetado, reverter, um por vez, com `git diff --stat` limpo ao fim de cada um. Mutante sobrevivente = escreva o teste que o mata e mostre que passa a falhar. Registre tabela: mutante, arquivo:linha, teste que matou ou teste novo.
3. **Integração real que não foi feita:** gravação concorrente (mesmo `messageId` em duas requisições, dois Confirmar do mesmo rascunho), isolamento entre dois usuários A e B (A nunca enxerga nem confirma rascunho de B; conta fixa e parcelado só aparecem para o dono), `GET /conversation/session` restaurando rascunho `RECURRING`/`INSTALLMENT` com `reviewReason`, limite do plano Grátis (3 contas fixas, 2 parcelados: a 4ª e a 3ª param com mensagem do plano e descartam o rascunho), contas fixas e parcelados da tela continuam funcionando (POST/GET com mesmas chaves).
4. **Chrome:** front real contra o back de teste. Capturas (tema claro e escuro, 360 px e desktop): conta fixa completa, parcelado completo, campo pendente, revisão por data passada ("Atenção"), `DONE` com etiqueta "Criado", erro de commit desconhecido, e que o turno manual sumiu ao recarregar a página. Salve capturas no scratchpad (não no repositório) e descreva o que viu. Se não conseguir abrir o Chrome, diga isso em vez de afirmar.
5. Corrigir o que achar (código e teste, em português). Sem mudar o contrato; dúvida de contrato vai para `duvidas.md`.
6. Escrever `resultado-revisao.md` nesta pasta (prosa normal): o que foi verificado, mutantes, integração, capturas, bugs achados e corrigidos, limites conhecidos, o que NÃO foi verificado.

## Regras

- Banco de teste só em containers descartáveis (`docker run --rm`), portas livres e novas. **Nunca** use ou pare: Postgres 55439 (outro projeto, Bora, dados reais), 5432/6379 (`agilis-*`), 5433/6380 (Lumen antigo), 3001 (outro projeto). Dev local é só leitura.
- Sem `sed -i` nem edição de script de teste por linha de comando fora do scratchpad; edite arquivos do repositório com a ferramenta de edição. O dono interrompeu o revisor anterior justamente numa edição por `sed -i`; se precisar mexer em script de integração, reescreva o arquivo inteiro no scratchpad.
- Não esperar com `sleep`; use comando em segundo plano ou loop com condição.
- Sem commit, push, amend, reset, deploy, dependência npm nova, segredo em arquivo ou relatório. NÃO rode `graphify` (o agente principal roda).
- No fim: containers e processos que você criou removidos; portas sem listener; `git status` só com os arquivos que você corrigiu mais `resultado-revisao.md`; nenhum mutante esquecido (`git diff` confere).
- Um subagente por vez. Se parar por limite de uso, diga exatamente onde parou.

## Relatório final (curto)

Arquivos alterados, comandos com saída real (números), mutantes (mortos / sobreviventes e teste novo), bugs achados e corrigidos, o que NÃO verificou.
