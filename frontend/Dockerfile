FROM node:20-alpine AS builder

WORKDIR /app

ARG FRONTEND_APP_API_BASE_URL=http://localhost:3001/api/v1
ARG FRONTEND_APP_WS_BASE_URL=http://localhost:3001
ARG FRONTEND_APP_CLIENT_LOGGING_ENABLED=true

ENV FRONTEND_APP_API_BASE_URL=$FRONTEND_APP_API_BASE_URL
ENV FRONTEND_APP_WS_BASE_URL=$FRONTEND_APP_WS_BASE_URL
ENV FRONTEND_APP_CLIENT_LOGGING_ENABLED=$FRONTEND_APP_CLIENT_LOGGING_ENABLED

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/frontend /usr/share/nginx/html

EXPOSE 80
