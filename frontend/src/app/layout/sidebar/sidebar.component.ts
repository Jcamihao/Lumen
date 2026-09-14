import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { NotificationCenterService } from '../../core/services/notification-center.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

type NavItem = {
  icon: string;
  label: string;
  route: string;
  exact?: boolean;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  BRL: 'R$',
  USD: '$',
  EUR: '€',
};

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, ThemeToggleComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.mobile-drawer]': 'mobile',
  },
})
export class SidebarComponent {
  @Input() mobile = false;
  @Output() readonly closeRequested = new EventEmitter<void>();

  protected readonly authService = inject(AuthService);
  protected readonly notificationCenter = inject(NotificationCenterService);
  private readonly api = inject(LifeApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly primaryNavItems: NavItem[] = [
    { label: 'Início', icon: 'space_dashboard', route: '/dashboard', exact: true },
    { label: 'Tarefas', icon: 'checklist', route: '/tasks' },
    { label: 'Finanças', icon: 'account_balance_wallet', route: '/finance' },
    { label: 'Metas', icon: 'flag', route: '/goals' },
    { label: 'Selah', icon: 'auto_awesome', route: '/assistant' },
  ];

  protected readonly secondaryNavItems: NavItem[] = [
    { label: 'Alertas', icon: 'notifications', route: '/notifications' },
    { label: 'Importar', icon: 'upload_file', route: '/imports' },
    { label: 'Configurações', icon: 'settings', route: '/settings' },
    { label: 'Ajuda', icon: 'help', route: '/support' },
  ];

  protected readonly syncStatusTone = computed<'online' | 'syncing' | 'offline'>(() => {
    if (this.api.offlineMode()) return 'offline';
    if (this.api.syncing() || this.api.pendingSyncCount() > 0) return 'syncing';
    return 'online';
  });

  protected readonly syncStatusLabel = computed(() => {
    switch (this.syncStatusTone()) {
      case 'offline':
        return 'Offline';
      case 'syncing':
        return 'Sincronizando';
      default:
        return 'Online • Sincronizado';
    }
  });

  protected readonly currencyLabel = computed(() => {
    const code = this.authService.currentUser()?.preferredCurrency || 'BRL';
    const symbol = CURRENCY_SYMBOLS[code];
    return symbol ? `${code} ${symbol}` : code;
  });

  protected readonly currencyOptions = Object.entries(CURRENCY_SYMBOLS).map(([code, symbol]) => ({
    code,
    symbol,
  }));

  protected readonly currencyMenuOpen = signal(false);
  protected readonly savingCurrency = signal(false);

  protected readonly userInitials = computed(() => {
    const name = this.authService.currentUser()?.name ?? '';
    return name.slice(0, 2).toUpperCase() || 'LU';
  });

  protected readonly userRoleLabel = computed(() =>
    this.authService.currentUser()?.role === 'ADMIN' ? 'Administrador' : 'Usuário',
  );

  protected readonly profileMenuOpen = signal(false);

  protected requestClose() {
    this.closeRequested.emit();
  }

  protected logout() {
    this.profileMenuOpen.set(false);
    this.authService.logout();
    this.requestClose();
  }

  protected setCurrency(code: string) {
    this.currencyMenuOpen.set(false);

    if (code === this.authService.currentUser()?.preferredCurrency) {
      return;
    }

    this.savingCurrency.set(true);
    this.api
      .updateUser({ preferredCurrency: code })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.authService.updateStoredUser(user);
          this.savingCurrency.set(false);
        },
        error: () => {
          this.savingCurrency.set(false);
          this.toast.error('Não foi possível trocar a moeda.');
        },
      });
  }
}
