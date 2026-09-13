import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { NotificationCenterService } from '../../core/services/notification-center.service';

type NavItem = {
  icon: string;
  label: string;
  route: string;
  exact?: boolean;
};

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
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
        return 'Sincronizado';
    }
  });

  protected requestClose() {
    this.closeRequested.emit();
  }

  protected logout() {
    this.authService.logout();
    this.requestClose();
  }
}
