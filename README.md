# LUMEN

Clareza para sua vida.

LUMEN e um SaaS de gestao de vida criado pela `codeStage Solucoes` para conectar tarefas, dinheiro, tempo e objetivos em uma unica experiencia. O produto foi desenhado como um monolito modular em NestJS com frontend Angular mobile-first, preparado para escalar sem perder velocidade de iteracao.

## Stack

- Backend: NestJS, Prisma ORM, PostgreSQL, Redis, JWT, Swagger
- Frontend: Angular standalone, TypeScript, SCSS, PWA, design system customizado
- Infra: Docker Compose, seeds realistas, cache e filas BullMQ/Redis

## Estrutura

```text
Lumen/
├── backend
│   ├── prisma
│   └── src
├── frontend
│   └── src
├── docs
├── docker-compose.yml
└── .env.example
```

## Dominios

- Usuarios e autenticacao
- Tarefas e categorias
- Financeiro e categorias
- Metas
- Lembretes
- Dashboard agregado
- Insights
- Forecast financeiro
- Importacao CSV
- Assistente de vida
- Notificacoes

## Como rodar

### Recomendado com Docker

```bash
cp .env.example .env
docker compose up --build
```

URLs:

- Frontend: `http://localhost:4201`
- Backend: `http://localhost:3001/api/v1`
- Swagger: `http://localhost:3001/api/docs`

### Desenvolvimento local

Node 20 e o caminho recomendado. O workspace atual conseguiu compilar com Node 16, mas varias dependencias modernas emitem alertas de engine e o setup mais estavel continua sendo Node 20.

```bash
cp .env.example .env
cp backend/.env.example backend/.env
npm install
npm --prefix backend install
npm --prefix frontend install
npm run dev:infra
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:seed
npm --prefix backend run start:dev
npm --prefix frontend run start
```

## Credenciais demo

- Usuario: `demo@lumen.local`
- Senha: `Demo123!`

## Endpoints principais

### Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /auth/me`

### Usuario

- `GET /users/me`
- `PATCH /users/me`
- `GET /users/me/privacy-export`
- `DELETE /users/me`

### Tasks

- `GET /tasks`
- `POST /tasks`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id`

### Financas

- `GET /transactions`
- `POST /transactions`
- `PATCH /transactions/:id`
- `DELETE /transactions/:id`

### Metas

- `GET /goals`
- `POST /goals`
- `PATCH /goals/:id`
- `PATCH /goals/:id/contribute`
- `DELETE /goals/:id`

### Inteligencia

- `GET /dashboard/summary`
- `GET /insights`
- `POST /insights/refresh`
- `GET /forecasts/current`
- `POST /assistant/ask`

### Extras

- `GET /reminders`
- `POST /reminders`
- `GET /notifications`
- `POST /imports/transactions/preview`
- `POST /imports/transactions/commit`

## Seeds e comportamento demo

O seed cria:

- categorias padrao de tarefas e financas
- tarefas com impacto financeiro
- historico financeiro mensal
- uma meta ativa
- lembretes futuros

Isso permite demonstrar:

- dashboard agregado
- insights de atraso e gastos
- forecast de 30 dias
- assistente respondendo com contexto real

## Privacidade e LGPD

O LUMEN agora inclui uma base tecnica de adequacao para LGPD no contexto do assistente com IA:

- aceite explicito do aviso de privacidade no cadastro
- consentimento separado e revogavel para uso do SelahIA
- minimizacao de dados enviados ao assistente externo
- redacao automatica de padroes como email, CPF e telefone antes do envio externo
- exportacao estruturada dos dados do titular em `GET /users/me/privacy-export`
- exclusao da conta e dos dados associados em `DELETE /users/me`

Observacao importante: isso melhora substancialmente a aderencia tecnica do produto, mas nao substitui validacao juridica, politica de privacidade publicada, contratos com operadores e governanca interna.

## Qualidade verificada

Validado neste workspace:

- `npm --prefix backend run build`
- `npm --prefix frontend run build`
- `npm --prefix backend test -- --runInBand`

Nao foi executado nesta rodada:

- `docker compose up --build`
- `npm --prefix backend run test:e2e`

## Documentacao adicional

- [Arquitetura](docs/architecture.md)
- [Design System](docs/design-system.md)
