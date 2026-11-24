# Resultado da revisao 9b-1 (cartao no lancamento pela conversa)

Data: 2026-11-24. Revisor: Claude Sonnet 5.5 (sessao unica). Branch feat/cartoes-no-bot (sem troca). Escopo: 7cd5536..HEAD.

## Veredito
APROVADO COM 1 DEFEITO CORRIGIDO. Fluxo ponta a ponta, isolamento, arquivado, concorrencia, Telegram e travas funcionam em banco real. Um defeito real (numero da lista de cartoes) achado e corrigido; 3 mutantes sobreviventes cobertos.

## Achados
1. DEFEITO (corrigido, 4e145df + 80943e2): a lista "Em qual cartao? 1) Itau 2) Bradesco 3) Principal" era refeita na ordem do 8d (padrao primeiro) na hora da resposta. Se o padrao mudava (make-default) entre a lista e a resposta, "1" gravava outro cartao (reproduzido em banco real: viu Itau, gravou Principal). Cartao arquivado no meio tambem deslocava os numeros. Correcao: a escolha usa a ordem em que a lista foi oferecida; se algum oferecido foi arquivado, a resposta NAO e usada, a lista nova e mostrada e passa a valer.
2. Cosmetico (nao corrigido, produto): enquanto o rascunho pergunta o cartao, o card mostra "Forma de pagamento: nao informado" (o CREDIT so entra ao escolher). Sugestao: mostrar "credito" ja na pergunta.
3. Observacao: a recusa por cartao arquivado/alheio usa a mensagem de dominio ("Cartao arquivado nao aceita novo lancamento.", sem acento). Aceitavel; se quiser acento, ajustar em credit-cards/card-link.
4. Observacao: a lista mostra todos os cartoes numerados (ex.: 6), mas numero so vale ate 5 (duvida 2 ja decidida pelo dono: manter).
5. Todo usuario nasce com cartao "Principal" (padrao, nao arquivavel). Logo "sem cartao nenhum" so existe por dado legado/SQL; "no credito" de conta nova usa o Principal e mostra o nome, e com 2+ pergunta a lista (comportamento correto pela regra do dono, mas pode surpreender).

## Verificacoes reais (Postgres 16 + Redis 7 descartaveis, rv9c-pg:15441 e rv9c-redis:16391; backend nest build em 13111; Bot API falsa em 13121)
Banco novo com todas as migrations. Contas A (Principal+Nubank), B (Principal, Itau, Bradesco, depois "R&D <b>x"), C (so Principal; depois arquivado por SQL).
- Rascunho -> confirmar: "gastei 50 no nubank mercado" grava CREDIT + cardId; recibo "no cartao Nubank" (OK, conferido no banco).
- "no cartao xpto": recusa com a lista (so cartoes de A), sessao IDLE, nada gravado (OK).
- "mercado no credito" com varios cartoes: pergunta depois da categoria; numero 2 e nome "bradesco" gravam o certo; "xpto" e "9" re-perguntam sem gravar (OK).
- "no credito mercado" (palavra depois) = descricao + CREDIT sem cardId, conforme decisao do dono (OK; cuidado ao testar).
- Cartao de B nunca resolvido por A: "no cartao itau" recusa; "no itau" vira descricao; "no bradesco" idem (OK).
- Sem cartao ativo (C via SQL): "no credito" e "no credito padaria" gravam CREDIT sem cardId; palavra vira descricao (OK).
- Receita "recebi 800 no itau": cartao ignorado, pergunta categoria normal (OK).
- Cartao arquivado entre rascunho e confirmacao: recusa clara, sessao IDLE, 0 linhas gravadas (OK).
- make-default durante a lista: DEFEITO 1 (reproduzido antes, corrigido; coberto por teste).
- Confirmar 3x em paralelo: 1 gravada (as 2 outras "ja processada"), 1 linha no banco (OK).
- Falha controlada: trigger que levanta excecao no insert -> "Nao consegui gravar... rascunho mantido", 0 linhas, sessao em AWAITING_CONFIRMATION (nao persistiu comprovadamente, OK). Resultado desconhecido: ver NAO verificado.
- Telegram (adapter real + Bot API falsa): lista de cartoes numerada chega no texto, escolha por numero/nome funciona, rascunho final com teclado confirmar/cancelar; nome de cartao "R&D <b>x" chega escapado (&amp;amp; e &lt;), sem virar tag. Com TELEGRAM_WRITES_ENABLED=false "confirmar" responde "confirme no app" e 0 linhas gravadas; com true grava com cartao e recibo "no cartao R&D <b>x".

## Mutantes proprios (22; rodados em card-expense, isolation, conversation.service.spec e src/telegram)
Mortos 22, sobreviventes finais 0, equivalentes 0.
- Sobreviveram na 1a rodada e foram cobertos com testes novos: M1 (conector "na" removido), M5 (numero so ate 4), M6 (nome ambiguo na escolha pega o primeiro). Agora mortos.
- M19 (ordem do 8d na escolha) so morreu depois de o mock do creditCard honrar orderBy (o mock antigo escondia o defeito 1).
- Descartado: 1a tentativa de M13 nao compilava (suites falhando por TS); refeita com condicao valida e morta.
- Lista: M1 conector na; M2 palavra cartao explicita; M3 ambiguo explicito pega o primeiro; M4 credito com varios usa o primeiro; M5 numero ate 4; M6 nome ambiguo pega o primeiro; M7 activeCards sem userId; M8 inclui arquivado; M9 receita usa cartao; M10 pickCard sem CREDIT; M11 confirmacao sem cardId; M12 recibo sem cartao; M13 recusa de cartao generica; M14 pergunta de cartao antes do resto; M15 notFound vira descricao; M16 removeTokenRange off-by-one; M17 creditDefault so com "cartao"; M18 nome exato sem normalizar; M19 ordem do 8d; M20 pendingField nao zera; M21 trava de escrita do Telegram ignorada; M22 sem cartao nao grava CREDIT.

## Numeros verdes (2026-11-24, conferido por Claude Sonnet 5.5)
- npx tsc --noEmit: limpo.
- Suite inteira --maxWorkers=2: 86 suites, 2164 testes verdes.
- conversation+credit-cards+transactions+telegram: 1037 testes verdes em TZ=UTC, America/Sao_Paulo e Asia/Tokyo.
- graphify update .: ok.
- Testes novos desta revisao: +8 em card-expense.spec (31 -> 39 com a it.each de conectores contando 6).

## Commits desta revisao
4e145df fix(conversa): escolha de cartao segue a ordem da lista mostrada; 80943e2 test (padrao trocado e arquivado); 4548fe7 test (conectores, 5/6, nome ambiguo). Mais este relatorio.

## NAO verificado
- Resultado desconhecido de gravacao (commit com queda de conexao): a injecao via trigger que mata o backend no COMMIT fez o Prisma 5.22 devolver sucesso sem persistir (reproduzido com Prisma puro, fora do app; o app respondeu "Registrado" com 0 linhas). Nao ha como o app saber nesse cenario; fica como risco conhecido do Prisma/commit, nao da 9b-1. O ramo "desconhecido" do motor segue coberto so por testes unitarios existentes.
- Confirmacao no canal WhatsApp com cartao (so APP e Telegram em banco real).
- Mais de 5 cartoes em banco real (coberto por teste unitario com 6).
- Frontend (nao faz parte do escopo 9b-1).
- Docker: containers do dono (detect-objects, wa-akg-db) seguiram de pe; lumen-postgres-1/lumen-redis-1 ja estavam parados no inicio e nao foram tocados.

## Limpeza
Containers rv9c-pg e rv9c-redis parados (--rm), servidor e Bot API falsa encerrados, arquivos temporarios removidos; portas 15441, 16391, 13111 e 13121 sem listener; 3306 e 8000 intactas.

## Proximos passos
1. Dono decide o item 2 (mostrar "credito" no card enquanto pergunta o cartao).
2. Conferencia independente do agente principal.
3. Merge na develop (--no-ff) e atualizar o handoff.
