import { CommonModule } from '@angular/common';
import {
  animate,
  group,
  query,
  style,
  transition,
  trigger,
} from '@angular/animations';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, startWith } from 'rxjs';
import { LifeApiService } from '../../core/services/life-api.service';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ToastComponent } from '../toast/toast.component';

@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, BottomNavComponent, ToastComponent],
  templateUrl: './workspace-shell.component.html',
  styleUrls: ['./workspace-shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('pageTransition', [
      transition('* <=> *', [
        style({ position: 'relative' }),
        query(
          ':enter, :leave',
          [
            style({
              position: 'absolute',
              inset: 0,
              width: '100%',
            }),
          ],
          { optional: true },
        ),
        group([
          query(
            ':leave',
            [
              animate(
                '220ms cubic-bezier(0.32, 0.72, 0, 1)',
                style({
                  opacity: 0,
                  transform: 'translate3d(-1.4rem, 0, 0) scale(0.985)',
                  filter: 'blur(6px)',
                }),
              ),
            ],
            { optional: true },
          ),
          query(
            ':enter',
            [
              style({
                opacity: 0,
                transform: 'translate3d(1.4rem, 0, 0) scale(0.992)',
                filter: 'blur(8px)',
              }),
              animate(
                '360ms cubic-bezier(0.22, 1, 0.36, 1)',
                style({
                  opacity: 1,
                  transform: 'translate3d(0, 0, 0) scale(1)',
                  filter: 'blur(0)',
                }),
              ),
            ],
            { optional: true },
          ),
        ]),
      ]),
    ]),
  ],
})
export class WorkspaceShellComponent {
  protected readonly mobileSidebarOpen = signal(false);
  protected readonly routeAnimationFlip = signal(false);
  private readonly router = inject(Router);
  private readonly api = inject(LifeApiService);
  protected readonly offlineMode = this.api.offlineMode;
  protected readonly syncing = this.api.syncing;
  protected readonly pendingSyncCount = this.api.pendingSyncCount;
  protected readonly failedSyncCount = this.api.failedSyncCount;
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
