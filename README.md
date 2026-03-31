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

## Offline e iPhone com Capacitor

O frontend agora tem base offline-first para:

- tarefas
- fluxo financeiro
- metas
- dashboard
- assistente em fallback local

Quando o app perde conexao, essas areas passam a ler e gravar no armazenamento local do dispositivo. Assim que a rede volta, o LUMEN tenta sincronizar automaticamente as mudancas pendentes.

Fluxo mobile com Capacitor:

```bash
npm run mobile:build
npm run mobile:add:ios
npm run mobile:sync
```

Atalhos equivalentes no frontend:

```bash
npm --prefix frontend run build:mobile
npm --prefix frontend run cap:add:ios
npm --prefix frontend run cap:sync
npm --prefix frontend run cap:open:ios
```

Arquivos principais dessa integracao:

- `frontend/capacitor.config.ts`
- `frontend/ios/`
- `frontend/src/app/core/services/network.service.ts`
- `frontend/src/app/core/services/offline-life.service.ts`
- `frontend/src/app/core/services/life-api.service.ts`

Observacoes importantes:

- o shell do app ja tem service worker para funcionamento offline do frontend em producao
- login e cadastro continuam dependendo da API na primeira autenticacao
- importacao com IA externa e leitura de nota fiscal continuam dependendo de conexao
- no Linux deste workspace o projeto iOS foi gerado, mas abrir e assinar o app ainda exige Xcode/CocoaPods no macOS

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

## Email com Resend

O backend agora inclui uma camada de envio por Resend para emails transacionais.

Fluxos conectados nesta integracao:

- email de boas-vindas apos cadastro
- email de lembrete quando o worker dispara um reminder agendado

Variaveis de ambiente no `backend/.env`:

- `RESEND_ENABLED=false`
- `RESEND_API_KEY=`
- `RESEND_BASE_URL=https://api.resend.com`
- `RESEND_FROM_EMAIL=` com um endereco do dominio verificado no Resend
- `RESEND_FROM_NAME=LUMEN`
- `RESEND_REPLY_TO=`
- `RESEND_TIMEOUT_MS=10000`

Observacoes:

- depois de verificar um dominio no Resend, voce pode enviar usando qualquer endereco desse dominio
- se `RESEND_ENABLED=false`, o app continua funcionando normalmente e apenas nao envia emails

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
