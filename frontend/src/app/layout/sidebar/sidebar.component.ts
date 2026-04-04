import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

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
  protected readonly navItems: NavItem[] = [
    { label: 'Início', icon: 'space_dashboard', route: '/dashboard', exact: true },
    { label: 'Tarefas', icon: 'checklist', route: '/tasks' },
    { label: 'Finanças', icon: 'account_balance_wallet', route: '/finance' },
    { label: 'Metas', icon: 'flag', route: '/goals' },
    { label: 'Selah', icon: 'auto_awesome', route: '/assistant' },
    { label: 'Alertas', icon: 'notifications', route: '/notifications' },
    { label: 'Importar', icon: 'upload_file', route: '/imports' },
    { label: 'Configurações', icon: 'settings', route: '/settings' },
    { label: 'Ajuda', icon: 'help', route: '/support' },
  ];

  protected requestClose() {
    this.closeRequested.emit();
  }

  protected logout() {
    this.authService.logout();
    this.requestClose();
  }
}
