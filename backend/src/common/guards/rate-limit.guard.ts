import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { CacheQueueService } from '../../cache-queue/cache-queue.service';

type HitWindow = {
  hits: number[];
};

type RateLimitPolicy = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
  message: string;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, HitWindow>();
  private readonly defaultPolicy: RateLimitPolicy = {
    keyPrefix: 'default',
    limit: 120,
    windowMs: 60_000,
    message: 'Muitas requisicoes em pouco tempo. Tente novamente em instantes.',
  };
  private readonly authLoginPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-login',
    limit: 8,
    windowMs: 10 * 60_000,
    message:
      'Muitas tentativas de login em pouco tempo. Aguarde alguns minutos e tente novamente.',
  };
  private readonly authRegisterPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-register',
    limit: 4,
    windowMs: 30 * 60_000,
    message:
      'Muitas tentativas de cadastro em pouco tempo. Aguarde antes de tentar novamente.',
  };
  private readonly authRefreshPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-refresh',
    limit: 20,
    windowMs: 10 * 60_000,
    message:
      'Muitas tentativas de renovacao de sessao. Aguarde um pouco antes de tentar novamente.',
  };
  private readonly authMfaVerifyPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-mfa-verify',
    limit: 10,
    windowMs: 10 * 60_000,
    message:
      'Muitas tentativas de verificacao MFA. Aguarde alguns minutos antes de tentar novamente.',
  };

  constructor(private readonly cacheQueueService: CacheQueueService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    if (request.method === 'OPTIONS') {
      return true;
    }

    const policy = this.resolvePolicy(request);
    const actorKey = this.resolveActorKey(request, policy);
    const routeKey = this.resolveRouteKey(request);
    const storageKey = `rate-limit:${policy.keyPrefix}:${routeKey}:${actorKey}`;
    const rateLimitState =
      (await this.cacheQueueService.hitRateLimitWindow(
        storageKey,
        policy.windowMs,
      )) ?? this.hitMemoryWindow(storageKey, policy.windowMs);

    const remaining = Math.max(policy.limit - rateLimitState.hits, 0);
    response.setHeader('X-RateLimit-Limit', String(policy.limit));
    response.setHeader('X-RateLimit-Remaining', String(remaining));
    response.setHeader(
      'X-RateLimit-Reset',
      String(Math.ceil(rateLimitState.resetAfterMs / 1_000)),
    );

    if (rateLimitState.hits > policy.limit) {
      response.setHeader(
        'Retry-After',
        String(Math.ceil(rateLimitState.resetAfterMs / 1_000)),
      );
      throw new HttpException(policy.message, HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private resolvePolicy(request: {
    method?: string;
    originalUrl?: string;
  }): RateLimitPolicy {
    const method = request.method?.toUpperCase() ?? 'GET';
    const path = this.normalizePath(request.originalUrl);

    if (method === 'POST' && path === '/api/v1/auth/login') {
      return this.authLoginPolicy;
    }

    if (method === 'POST' && path === '/api/v1/auth/register') {
      return this.authRegisterPolicy;
    }

    if (method === 'POST' && path === '/api/v1/auth/refresh') {
      return this.authRefreshPolicy;
    }

    if (method === 'POST' && path === '/api/v1/auth/mfa/verify-login') {
      return this.authMfaVerifyPolicy;
    }

    return this.defaultPolicy;
  }

  private resolveActorKey(
    request: {
      ip?: string;
      user?: { sub?: string };
      body?: Record<string, unknown>;
    },
    policy: RateLimitPolicy,
  ) {
    const userId = request.user?.sub?.trim();
    const ipAddress = request.ip?.trim() || 'anonymous';

    if (policy.keyPrefix === 'auth-login') {
      const email =
        typeof request.body?.email === 'string'
          ? request.body.email.trim().toLowerCase()
          : 'unknown';
      return `${ipAddress}:${email}`;
    }

    if (policy.keyPrefix === 'auth-register') {
      return ipAddress;
    }

    if (policy.keyPrefix === 'auth-mfa-verify') {
      const challengeId =
        typeof request.body?.challengeId === 'string'
          ? request.body.challengeId.trim()
          : 'unknown';
      return `${ipAddress}:${challengeId}`;
    }

    return userId || ipAddress;
  }

  private resolveRouteKey(request: { method?: string; originalUrl?: string }) {
    const method = request.method?.toUpperCase() ?? 'GET';
    const path = this.normalizePath(request.originalUrl);
    return `${method}:${path}`;
  }

  private normalizePath(path?: string) {
    return (path ?? 'unknown').split('?')[0] || 'unknown';
  }

  private hitMemoryWindow(key: string, windowMs: number) {
    const now = Date.now();
    const record = this.windows.get(key) ?? { hits: [] };

    record.hits = record.hits.filter((timestamp) => now - timestamp < windowMs);
    record.hits.push(now);
    this.windows.set(key, record);

    const oldestHit = record.hits[0] ?? now;
    const resetAfterMs = Math.max(windowMs - (now - oldestHit), 1_000);

    return {
      hits: record.hits.length,
      resetAfterMs,
    };
  }
}
