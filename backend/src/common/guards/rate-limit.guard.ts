import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

type HitWindow = {
  hits: number[];
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, HitWindow>();
  private readonly limit = 120;
  private readonly windowMs = 60_000;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const routeKey = `${request.method}:${request.route?.path ?? request.path ?? 'unknown'}`;
    const actor = request.user?.sub ?? request.ip ?? request.headers['x-forwarded-for'] ?? 'anonymous';
    const key = `${actor}:${routeKey}`;
    const now = Date.now();
    const record = this.windows.get(key) ?? { hits: [] };

    record.hits = record.hits.filter((timestamp) => now - timestamp < this.windowMs);

    if (record.hits.length >= this.limit) {
      throw new HttpException(
        'Muitas requisicoes em pouco tempo. Tente novamente em instantes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.hits.push(now);
    this.windows.set(key, record);
    return true;
  }
}
