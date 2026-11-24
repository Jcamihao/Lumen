# Brief de revisao 9b-3b: criar cartao pela conversa (branch feat/cartoes-no-bot; NUNCA troque de branch)

Voce e o REVISOR (sonnet). Fale curto (caveman). Leia CLAUDE.md, ~/.claude/CLAUDE.md, contrato docs/superpowers/specs/2026-11-24-conversa-contrato-item-9b.md, brief-9b3b.md, resultado-9b3b.md, resultado-revisao-9b23.md, duvidas.md. Escopo: git diff fba0031..HEAD. Decisao do dono: o bot pergunta o dia de fechamento (1..31); vencimento opcional so se vier na frase; cartao novo nao vira padrao; teto 10 ativos; nome 1..40 unico sem caixa/acento entre ativos.

## Verificar (REAL; Docker ligado)
- Conteineres descartaveis (docker run --rm) SO com nomes rv9e-*, portas livres com ss -ltn, Postgres 16 + Redis 7. NUNCA toque em lumen-postgres-1, lumen-redis-1, wa-akg-db, detect-objects nem nas portas 5433, 6380, 3306, 8000.
- Banco limpo com todas as migrations; backend nest build em porta propria; contas A, B, C.
- Ponta a ponta: "criar cartao X" -> pergunta fechamento -> resposta valida/invalida -> resumo -> confirmar -> cartao no banco com closingDay/dueDay certos, nao padrao, countAllPayments false, recibo; "criar cartao X fecha dia 10 vence dia 17" direto; cancelar; expirar; nome duplicado (caixa/acento/pontuacao); vazio/longo/nome com palavras "fecha/vence"; teto de 10 (inclui corrida de duas criacoes quando faltam so 1 vaga: so uma grava); nome tomado entre rascunho e confirmacao; confirmar 3x em paralelo (1 so cartao); concorrencia com make-default/arquivar/renomear; falha controlada antes do commit; o cartao novo aparece em "meus cartoes", nas buscas de lancamento (9b-1), leitura (9b-2) e renomear (9b-3); nada vaza entre A, B e C; Telegram (Bot API falsa): com TELEGRAM_WRITES_ENABLED=false rascunho aparece e nada grava.
- >= 14 mutantes proprios. Registre mortos/sobreviventes/equivalentes e cubra os sobreviventes reais.

## Entrega
- Corrija DEFEITOS com commits separados (fix(...) em portugues, Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>), sem amend/reset/push, sem trocar de branch. Duvida de produto vai para o relatorio.
- Ao terminar: remova TODOS os conteineres/arquivos temporarios seus, confirme portas sem listener e que os conteineres do dono seguem de pe. Rode tsc, a suite inteira (--maxWorkers=2), os 3 fusos nos dominios afetados e graphify update . na raiz.
- Escreva .superpowers/sdd/cartoes-no-bot-9b/resultado-revisao-9b3b.md: veredito, achados, mutantes, verificacoes reais com numeros, NAO verificado. Se parar por limite, diga onde parou.
