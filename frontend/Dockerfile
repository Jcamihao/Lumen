FROM node:20-alpine AS builder

WORKDIR /app

ARG FRONTEND_APP_API_BASE_URL=http://localhost:3001/api/v1
ARG FRONTEND_APP_WS_BASE_URL=http://localhost:3001
# A flag e lida em tempo de BUILD (scripts/generate-runtime-config.mjs): ligar/desligar exige rebuild da imagem.
ARG FRONTEND_APP_MFA_ENABLED=false

ENV FRONTEND_APP_API_BASE_URL=$FRONTEND_APP_API_BASE_URL
ENV FRONTEND_APP_WS_BASE_URL=$FRONTEND_APP_WS_BASE_URL
ENV FRONTEND_APP_MFA_ENABLED=$FRONTEND_APP_MFA_ENABLED

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/frontend /usr/share/nginx/html

EXPOSE 80
