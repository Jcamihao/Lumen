# Resultado: teste ponta a ponta antes/depois do merge develop -> master

Data: 2026-11-25. Quem conferiu: agente principal (Claude Sonnet 5.5), sessão única, sem subagentes nesta etapa (o verificador sonnet foi interrompido pelo dono antes de produzir resultado). Código testado: `develop` em `5d333b7`; a `master` ficou em `5601fab` (merge `--no-ff`, árvore idêntica à da develop: `git diff develop master` vazio). Sem push (sem credencial do GitHub nesta máquina).

## Veredito: GO (nenhum defeito novo de código achado). Há 3 limitações antigas e pré-requisitos de produção abaixo.

## O que foi feito
- Merge `develop` -> `master` com `--no-ff` (`5601fab`): 284 commits (itens 4 a 11a, 8, 9, 10; tags v1.7.0 a v1.19.0). A `develop` foi mantida.
- Ambiente descartável: Postgres 16 e Redis 7 (`docker run --rm`, nomes `rv10-*`, portas 56711/56712), backend compilado em 13500 com variáveis inline (o backend lê o `.env` da raiz, que aponta ao 5433 do dono: não usado), app estático em 14500, serviço falso local em 13600 (Bot API do Telegram, WA-AKG, Selah lento, Asaas). Tudo removido no fim; portas sem listener; containers do dono intocados.

## Números (2026-11-25)
| Checagem | Resultado |
| --- | --- |
| Migrations em banco limpo | 33 de 33 aplicadas, `migrate diff` vazio |
| Upgrade com dados (versão da master -> atual) | 4 usuários, 5 lançamentos, 3 tetos, 2 categorias: contagens iguais antes e depois; cartão "Principal" por usuário; clamp 1..31 (0->1, 40->31, -3->1, vencimento 45->31, 0->1, nulo continua nulo); tetos ligados ao cartão; lançamentos antigos com cardId nulo |
| `tsc` backend | limpo |
| Jest backend inteiro | 91 suítes, 2354 testes, verdes em UTC, America/Sao_Paulo e Asia/Tokyo |
| Frontend | `ng build` de produção ok; `ng test` 551 SUCCESS (UTC) |
| API ponta a ponta (3 contas A/B/C) | 70 de 70: cadastro, login, cartões (criar, duplicado 409, closingDay 32 = 400, padrão, arquivar), lançamento com cartão, PIX/receita com cardId = 400, filtro por cartão, ciclo e teto (definir, limpar, 409 repetido), parcelado e conta fixa com cartão, envelope, meta, tarefa, 17 GETs, exportação, bot (meus cartões, gastei no Nubank, criar e renomear cartão), isolamento A/B (404 em tudo), sem token = 401 |
| Concorrência | 120 rodadas x 9 operações em paralelo (make-default, teto, PATCH/DELETE de cartão, edição de lançamento): 0 deadlock, 0 erro 500, sempre exatamente 1 cartão padrão ativo |
| Redis pausado | API responde: login inválido 401 em 1,6 s, sem pendurar; volta ao normal ao despausar |
| Postgres removido/pausado | removido: erros 500 imediatos; pausado: requisição fica pendurada (ver limitações); recupera ao voltar; e2e 70/70 depois |
| Billing ligado (Asaas falso) | plano Grátis com limites (metas 2, reservas 1, contas fixas 3, parcelados 2, cartões 1; Individual 5 cartões; Compartilhado 10); 3ª meta e 2º cartão recusados com 403 PLAN_LIMIT; webhook Asaas sem token 401; com token e assinatura desconhecida não quebra |
| Telegram (Bot API falsa) | pareamento por código, chat mascarado, "meus cartões", gasto no cartão com rascunho e confirmação gravou "lanche:Nubank", chat desconhecido só recebe orientação |
| WhatsApp (WA-AKG falso) | assinatura HMAC inválida/ausente 401; vínculo por código; "meus cartões" respondido; reentrega do mesmo id não duplica |
| Selah pendurado (40 s) | conversa e assistente degradam em ~1,5 s com texto claro ("A IA está indisponível agora") |
| Chrome real (headless) | login pela UI; 10 rotas (dashboard, finanças, cartão, assistente, configurações, plano, importar, metas, tarefas, alertas) sem erro de console e sem 5xx; telas de Finanças, Cartões, Plano e Selah lidas em 1280 e 390 px |

## Achados (nenhum bloqueia o merge; todos já existiam antes desta rodada)
1. **Sem timeout de banco:** com o Postgres pausado, a requisição que usa o banco fica pendurada mais de 25 s (nenhum `pool_timeout`/`statement_timeout` configurado). Recuperou ao voltar. Sugestão: definir timeouts na `DATABASE_URL`.
2. **`/health` não verifica o banco:** devolve 200 mesmo com o Postgres fora.
3. **Aviso na subida:** "Workers desativados porque o Redis nao esta disponivel" sai uma vez no início mesmo com o Redis chegando logo depois ("Redis conectado"): corrida de inicialização, cosmético, não conferido se os workers sobem depois.
4. **Prisma 5.22 engole falha de COMMIT** (risco antigo, registrado no handoff).

## Pré-requisitos antes de ligar em produção (ação do dono)
- Rodar o SELECT do `.superpowers/sdd/varios-cartoes-9a/resultado-9a3.md` (dado fora de 1..31) antes de aplicar a migration `20261123120000_credit_cards`; fazer backup do banco antes das 8 migrations novas desde a v1.6.0 (a última é `20261124150000_billing_groups`).
- Variáveis novas (ver `.env.example`): `BILLING_ENABLED` (padrão false), `ASAAS_*`, `TELEGRAM_*` (instância única do backend com `TELEGRAM_ENABLED=true`), `WHATSAPP_*`/`WA_AKG_*`, `SELAH_*`, `ASSISTANT_AI_MODE`.
- Com o billing ligado o plano Grátis limita a 1 cartão: usuários atuais com mais de um cartão não existem (a migration cria só o "Principal"), mas o bot "criar cartão" por conversa no Grátis bate no limite (caminho do bot sob billing não verificado).
- Push de `master` e `develop` (hoje 284 e 46 commits à frente do remoto) e deploy: com o dono.

## NÃO verificado (e por quê)
- Asaas sandbox/produção, Telegram real (BotFather), WhatsApp real (WA-AKG com sessão/QR), Gemini/Selah reais, Resend: sem credenciais/contas aqui; só serviços falsos locais.
- Aplicativo nativo (Capacitor/iOS), modo offline real no navegador, leitor de tela, Safari.
- `ng test` do frontend só em UTC; teste do frontend repetido 15/30 vezes; o bot "criar cartão" sob plano Grátis com billing ligado; fluxo de importação de nota com imagem real (sem IA externa); upgrade de dados com volume de produção.
- Fluxos de grupo/convite do plano Compartilhado (item 11a) além de `GET /billing/group` e das rotas mapeadas.
- Os testes automáticos de falha de COMMIT (Prisma).

## Incidentes desta rodada (registrados para não repetir)
- `docker stop` em contêiner criado com `--rm` o apaga: para simular queda use `docker pause`/`unpause`.
- Alguém criou/trocou a pasta principal para a branch `feat/cartoes-9c2` durante o teste (não fui eu); por isso este relatório foi commitado num worktree separado.
- Os contêineres `orquestrador-ia-*` (outro projeto) apareceram parados (Exited) durante a rodada; não foram tocados por mim (só parei `rv10-pg` e `rv10-redis`).
