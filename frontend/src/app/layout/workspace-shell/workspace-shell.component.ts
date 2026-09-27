import { CommonModule } from '@angular/common';
import {
  animate,
  group,
  query,
  style,
  transition,
  trigger,
} from '@angular/animations';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, startWith } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { ToastService } from '../../core/services/toast.service';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ToastComponent } from '../toast/toast.component';
import { TopbarComponent } from '../topbar/topbar.component';

@Component({
    selector: 'app-workspace-shell',
    imports: [CommonModule, RouterOutlet, SidebarComponent, BottomNavComponent, TopbarComponent, ToastComponent],
    templateUrl: './workspace-shell.component.html',
    styleUrls: ['./workspace-shell.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('pageTransition', [
            transition('* <=> *', [
                style({ position: 'relative' }),
                query(':enter, :leave', [
                    style({
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                    }),
                ], { optional: true }),
                group([
                    query(':leave', [
                        animate('220ms cubic-bezier(0.32, 0.72, 0, 1)', style({
                            opacity: 0,
                            transform: 'translate3d(-1.4rem, 0, 0) scale(0.985)',
                            filter: 'blur(6px)',
                        })),
                    ], { optional: true }),
                    query(':enter', [
                        style({
                            opacity: 0,
                            transform: 'translate3d(1.4rem, 0, 0) scale(0.992)',
                            filter: 'blur(8px)',
                        }),
                        animate('360ms cubic-bezier(0.22, 1, 0.36, 1)', style({
                            opacity: 1,
                            transform: 'translate3d(0, 0, 0) scale(1)',
                            filter: 'blur(0)',
                        })),
                    ], { optional: true }),
                ]),
            ]),
        ]),
    ]
})
export class WorkspaceShellComponent {
  protected readonly mobileSidebarOpen = signal(false);
  protected readonly routeAnimationFlip = signal(false);
  private readonly router = inject(Router);
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  // `=== null` (e nao `!emailVerifiedAt`): um usuario em cache de antes desse
  // campo existir tem `undefined` e nao deve ver o aviso por engano.
  protected readonly showVerifyBanner = computed(
    () => this.authService.currentUser()?.emailVerifiedAt === null,
  );
  protected readonly verifyBannerEmail = computed(
    () => this.authService.currentUser()?.email ?? '',
  );
  protected readonly resendingVerification = signal(false);
  protected readonly offlineMode = this.api.offlineMode;
  protected readonly syncing = this.api.syncing;
  protected readonly pendingSyncCount = this.api.pendingSyncCount;
  protected readonly failedSyncCount = this.api.failedSyncCount;
  protected resendVerification() {
    if (this.resendingVerification()) {
      return;
    }

    this.resendingVerification.set(true);
    this.authService
      .resendEmailVerification()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.resendingVerification.set(false);
          this.toast.success(
            response.alreadyVerified
              ? 'Seu email já está confirmado.'
              : 'Enviamos um novo link de confirmação.',
          );
        },
        error: (error) => {
          this.resendingVerification.set(false);
          const message = error?.error?.message;
          this.toast.error(
            typeof message === 'string' ? message : 'Não foi possível reenviar agora.',
          );
        },
      });
  }

  protected readonly showSyncBanner = computed(
    () =>
      this.offlineMode() ||
      this.syncing() ||
      this.pendingSyncCount() > 0 ||
      this.failedSyncCount() > 0,
  );
  protected readonly syncBannerTone = computed(() => {
    if (this.failedSyncCount() > 0) {
      return 'warning';
    }

    if (this.offlineMode()) {
      return 'offline';
    }

    return 'info';
  });
  protected readonly syncBannerTitle = computed(() => {
    if (this.failedSyncCount() > 0) {
      return 'Sincronizacao com pendencias';
    }

    if (this.syncing()) {
      return 'Sincronizando alteracoes offline';
    }

    if (this.offlineMode()) {
      return 'Modo offline ativo';
    }

    return 'Alteracoes locais aguardando envio';
  });
  protected readonly syncBannerMessage = computed(() => {
    if (this.failedSyncCount() > 0) {
      const firstFailed = this.api
        .syncQueueItems()
        .find((item) => item.status === 'failed');
      const failureMessage = firstFailed?.lastError || 'Revise a conexao e tente novamente.';
      return `${this.failedSyncCount()} item(ns) falharam. ${failureMessage}`;
    }

    if (this.syncing()) {
      return `${this.pendingSyncCount()} item(ns) locais estao sendo enviados para o servidor.`;
    }

    if (this.offlineMode()) {
      return `${this.pendingSyncCount()} item(ns) ficarao salvos no aparelho ate a conexao voltar.`;
    }

    return `${this.pendingSyncCount()} item(ns) ainda aguardam sincronizacao.`;
  });

  constructor() {
    let isFirstRoute = true;

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.mobileSidebarOpen.set(false);

        if (isFirstRoute) {
          isFirstRoute = false;
          return;
        }

        this.routeAnimationFlip.update((value) => !value);
      });
  }

  protected openMobileSidebar() {
    this.mobileSidebarOpen.set(true);
  }

  protected closeMobileSidebar() {
    this.mobileSidebarOpen.set(false);
  }

  protected handleBottomNavNavigation() {
    this.closeMobileSidebar();
  }

  protected retryFailedSync() {
    this.api.retryFailedSync();
  }

  protected prepareRoute(outlet: RouterOutlet) {
    if (!outlet.isActivated) {
      return this.router.url;
    }

    return outlet.activatedRoute?.routeConfig?.path ?? this.router.url;
  }
}
