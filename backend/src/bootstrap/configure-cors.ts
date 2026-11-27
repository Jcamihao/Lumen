import { INestApplication } from '@nestjs/common';

export function configureCors(app: INestApplication, allowedOrigins: string[]): void {
  app.enableCors({
    origin: (origin, callback) => {
      // Origem fora da lista: so nao envia os cabecalhos CORS (o navegador bloqueia).
      // Passar um Error aqui virava HTTP 500 e poluia o monitoramento.
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true,
  });
}
