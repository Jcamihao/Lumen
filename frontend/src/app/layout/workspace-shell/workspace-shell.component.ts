import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { LifeApiService } from '../../core/services/life-api.service';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { SidebarComponent } from '../sidebar/sidebar.component';

@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, BottomNavComponent],
  templateUrl: './workspace-shell.component.html',
  styleUrls: ['./workspace-shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellComponent {
  protected readonly mobileSidebarOpen = signal(false);
  protected readonly routeAnimationFlip = signal(false);
  private readonly router = inject(Router);
  private readonly api = inject(LifeApiService);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
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

    effect(() => {
      this.currentUrl();
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
}
