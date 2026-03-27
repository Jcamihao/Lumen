# Arquitetura LUMEN

## Visao

LUMEN foi estruturado como um monolito modular para acelerar produto sem abrir mao de separacao clara entre dominios. Cada modulo conversa com Prisma e, quando necessario, dispara efeitos assincromos via Redis/BullMQ.

## Backend

- `auth`: registro, login, refresh token, `me`
- `users`: preferencias do usuario
- `tasks`: CRUD de tarefas, subtarefas e impacto financeiro
- `task-categories`: organizacao semantica das tarefas
- `transactions`: receitas, despesas e transferencias
- `finance-categories`: categorias financeiras por usuario
- `goals`: metas, progresso e aportes
- `reminders`: agenda integrada a tarefas, transacoes e metas
- `dashboard`: endpoint agregador `/dashboard/summary`
- `insights`: motor de regras para alertas e orientacao
- `forecasts`: previsao financeira de 30 dias
- `imports`: preview e commit de CSV com deduplicacao
- `assistant`: respostas em linguagem natural baseadas no estado atual
- `notifications`: feed de notificacoes
- `life-engine`: invalida cache, agenda reminders e dispara reprocessamentos

## Fluxo inteligente

1. O usuario cria ou altera tarefas, transacoes e metas.
2. O `LifeEngineService` invalida o cache do dashboard.
3. Redis recebe jobs para atualizar insights e forecast.
4. Workers processam lembretes e criam notificacoes.
5. O dashboard retorna uma leitura coerente da vida atual do usuario.

## Dados centrais

- `User`
- `TaskCategory`
- `FinanceCategory`
- `Task`
- `TaskSubtask`
- `Transaction`
- `Goal`
- `Reminder`
- `Insight`
- `Forecast`
- `ImportJob`
- `Notification`

## Frontend

O frontend usa Angular standalone com shell autenticado por rotas. As features ficam separadas por pagina:

- dashboard
- tasks
- finances
- goals
- assistant
- imports
- settings

O design system se apoia em:

- tipografia `Manrope` + `Space Grotesk`
- cards reutilizaveis
- tokens de tema light/dark
- empty states
- skeleton loading

## Escalabilidade

O projeto foi preparado para evoluir em tres frentes:

- mover workers Redis para processos dedicados
- trocar assistente heuristico por LLM real
- abrir historico temporal de insights/forecast para analytics avancado
