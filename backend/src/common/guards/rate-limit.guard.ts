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
  // Limites de MFA por DESAFIO (nao por IP): quem tem a senha e troca de IP nao ganha
  // tentativas novas no mesmo desafio; pra tentar de novo precisa refazer o login.
  private readonly authMfaVerifyPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-mfa-verify',
    limit: 5,
    windowMs: 10 * 60_000,
    message:
      'Muitas tentativas de verificacao MFA. Aguarde alguns minutos antes de tentar novamente.',
  };

  private readonly authMfaBypassRequestPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-mfa-bypass-request',
    limit: 3,
    windowMs: 15 * 60_000,
    message:
      'Muitos pedidos de codigo por email. Aguarde alguns minutos antes de pedir de novo.',
  };
  // Codigo do email tem so 6 digitos: poucas tentativas por codigo emitido.
  private readonly authMfaBypassVerifyPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-mfa-bypass-verify',
    limit: 5,
    windowMs: 10 * 60_000,
    message:
      'Muitas tentativas com o codigo do email. Peca um codigo novo e tente de novo em alguns minutos.',
  };
  // Confirmar/desativar MFA e regenerar codigos conferem um codigo TOTP com so o
  // access token: sem limite viraria forca bruta do codigo pra quem roubou o token.
  private readonly authMfaManagePolicy: RateLimitPolicy = {
    keyPrefix: 'auth-mfa-manage',
    limit: 10,
    windowMs: 10 * 60_000,
    message:
      'Muitas tentativas de configurar o MFA. Aguarde alguns minutos e tente novamente.',
  };

  private readonly authForgotPasswordPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-forgot-password',
    limit: 3,
    windowMs: 15 * 60_000,
    message:
      'Muitos pedidos de redefinicao de senha. Aguarde alguns minutos antes de pedir de novo.',
  };
  private readonly authResetPasswordPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-reset-password',
    limit: 10,
    windowMs: 15 * 60_000,
    message:
      'Muitas tentativas de redefinir a senha. Aguarde alguns minutos e tente novamente.',
  };
  private readonly authVerifyEmailPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-verify-email',
    limit: 20,
    windowMs: 15 * 60_000,
    message:
      'Muitas tentativas de confirmar o email. Aguarde alguns minutos e tente novamente.',
  };
  private readonly authResendVerificationPolicy: RateLimitPolicy = {
    keyPrefix: 'auth-resend-verification',
    limit: 3,
    windowMs: 60 * 60_000,
    message:
      'Voce ja pediu varios emails de confirmacao. Aguarde um pouco antes de pedir de novo.',
  };
  // Exclusao de conta confere a senha: sem limite viraria um oraculo de senha
  // para quem roubou um access token.
  private readonly deleteAccountPolicy: RateLimitPolicy = {
    keyPrefix: 'users-delete-account',
    limit: 5,
    windowMs: 15 * 60_000,
    message:
      'Muitas tentativas de exclusao de conta. Tente novamente em alguns minutos.',
  };
  // Feedback/suporte e texto livre gravado no banco: limite por usuario contra spam.
  private readonly supportCreatePolicy: RateLimitPolicy = {
    keyPrefix: 'support-create',
    limit: 10,
    windowMs: 15 * 60_000,
    message: 'Muitos envios em pouco tempo. Tente novamente em alguns minutos.',
  };
  private readonly emailUnsubscribePolicy: RateLimitPolicy = {
    keyPrefix: 'email-unsubscribe',
    limit: 20,
    windowMs: 15 * 60_000,
    message: 'Muitas tentativas de descadastro. Tente novamente em instantes.',
  };
  // Abrir checkout chama o Asaas de verdade (cria recurso do lado deles) por
  // usuario autenticado: limite baixo, generoso o bastante pra reabrir apos erro.
  private readonly billingCheckoutPolicy: RateLimitPolicy = {
    keyPrefix: 'billing-checkout',
    limit: 5,
    windowMs: 60 * 60_000,
    message: 'Muitas tentativas de assinatura em pouco tempo. Tente novamente mais tarde.',
  };
  // Rota publica, sem usuario autenticado (cai em ipAddress): limite alto e por
  // janela curta, generoso o bastante pra rajadas legitimas de reenvio do Asaas
  // (entrega "pelo menos uma vez", 15 tentativas) sem abrir a porta pra abuso.
  private readonly billingWebhookPolicy: RateLimitPolicy = {
    keyPrefix: 'billing-webhook',
    limit: 300,
    windowMs: 5 * 60_000,
    message: 'Muitas requisicoes de webhook em pouco tempo. Tente novamente em instantes.',
  };
  // Sincronizar chama o Asaas de verdade por usuario autenticado: limite generoso
  // o bastante pra reconferir apos um webhook perdido, sem virar polling disfarcado.
  private readonly billingSyncPolicy: RateLimitPolicy = {
    keyPrefix: 'billing-sync',
    limit: 10,
    windowMs: 60 * 60_000,
    message: 'Muitas tentativas de sincronizacao em pouco tempo. Tente novamente mais tarde.',
  };

  // Webhook do WA-AKG: rota publica (balde por IP). Limite alto para rajadas de mensagens
  // de um numero, sem deixar a rota virar porta para flood.
  private readonly whatsappWebhookPolicy: RateLimitPolicy = {
    keyPrefix: 'whatsapp-webhook',
    limit: 600,
    windowMs: 5 * 60_000,
    message: 'Muitas requisicoes de webhook em pouco tempo. Tente novamente em instantes.',
  };
  // Gerar codigo de vinculo: por usuario autenticado, para nao virar gerador de codigos em massa.
  private readonly whatsappLinkCodePolicy: RateLimitPolicy = {
    keyPrefix: 'whatsapp-link-code',
    limit: 5,
    windowMs: 60 * 60_000,
    message: 'Muitos codigos de vinculo gerados em pouco tempo. Tente novamente mais tarde.',
  };

  private readonly policyByRoute: ReadonlyMap<string, RateLimitPolicy> = new Map([
    ['POST /api/v1/auth/login', this.authLoginPolicy],
    ['POST /api/v1/auth/register', this.authRegisterPolicy],
    ['POST /api/v1/auth/refresh', this.authRefreshPolicy],
    ['POST /api/v1/auth/mfa/verify-login', this.authMfaVerifyPolicy],
    ['POST /api/v1/auth/mfa/email-bypass/request', this.authMfaBypassRequestPolicy],
    ['POST /api/v1/auth/mfa/email-bypass/verify', this.authMfaBypassVerifyPolicy],
    ['POST /api/v1/auth/mfa/setup', this.authMfaManagePolicy],
    ['POST /api/v1/auth/mfa/confirm-setup', this.authMfaManagePolicy],
    ['POST /api/v1/auth/mfa/recovery-codes/regenerate', this.authMfaManagePolicy],
    ['POST /api/v1/auth/mfa/disable', this.authMfaManagePolicy],
    ['POST /api/v1/auth/forgot-password', this.authForgotPasswordPolicy],
    ['POST /api/v1/auth/reset-password', this.authResetPasswordPolicy],
    ['POST /api/v1/auth/verify-email', this.authVerifyEmailPolicy],
    ['POST /api/v1/auth/resend-verification', this.authResendVerificationPolicy],
    ['POST /api/v1/email-preferences/unsubscribe', this.emailUnsubscribePolicy],
    ['POST /api/v1/support-requests', this.supportCreatePolicy],
    ['DELETE /api/v1/users/me', this.deleteAccountPolicy],
    ['POST /api/v1/billing/checkout', this.billingCheckoutPolicy],
    ['POST /api/v1/billing/webhooks/asaas', this.billingWebhookPolicy],
    ['POST /api/v1/billing/sync', this.billingSyncPolicy],
    ['POST /api/v1/whatsapp/webhook', this.whatsappWebhookPolicy],
    ['POST /api/v1/whatsapp/link-code', this.whatsappLinkCodePolicy],
  ]);

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
    return this.policyByRoute.get(`${method} ${path}`) ?? this.defaultPolicy;
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

    if (
      policy.keyPrefix === 'auth-login' ||
      policy.keyPrefix === 'auth-forgot-password'
    ) {
      const email =
        typeof request.body?.email === 'string'
          ? request.body.email.trim().toLowerCase()
          : 'unknown';
      return `${ipAddress}:${email}`;
    }

    if (
      policy.keyPrefix === 'auth-register' ||
      policy.keyPrefix === 'auth-reset-password' ||
      policy.keyPrefix === 'auth-verify-email' ||
      policy.keyPrefix === 'email-unsubscribe'
    ) {
      return ipAddress;
    }

    if (
      policy.keyPrefix === 'auth-mfa-verify' ||
      policy.keyPrefix === 'auth-mfa-bypass-request'
    ) {
      return this.challengeActorKey(request.body?.challengeId, ipAddress);
    }

    if (policy.keyPrefix === 'auth-mfa-bypass-verify') {
      return this.challengeActorKey(request.body?.bypassChallengeId, ipAddress);
    }

    return userId || ipAddress;
  }

  // Id de desafio valido = balde proprio (independente de IP); qualquer outra coisa cai
  // num balde por IP, pra lixo nao esgotar o balde de ninguem.
  private challengeActorKey(value: unknown, ipAddress: string) {
    const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[0-9a-f-]{36}$/.test(id) ? `challenge:${id}` : `${ipAddress}:invalid-challenge`;
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
