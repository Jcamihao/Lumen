import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SpotlightHoverDirective } from '../../shared/directives/spotlight-hover/spotlight-hover.directive';

type NavItem = {
  icon: string;
  label: string;
  route: string;
};

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, SpotlightHoverDirective],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
  protected readonly toolsExpanded = signal(true);
  protected readonly primaryItems: NavItem[] = [
    { label: 'Painel', icon: 'space_dashboard', route: '/dashboard' },
    { label: 'Tarefas', icon: 'checklist', route: '/tasks' },
    { label: 'Finanças', icon: 'account_balance_wallet', route: '/finances' },
    { label: 'Metas', icon: 'flag', route: '/goals' },
    { label: 'Assistente', icon: 'auto_awesome', route: '/assistant' },
    { label: 'Ajustes', icon: 'settings', route: '/settings' },
  ];

  protected readonly toolItems: NavItem[] = [
    { label: 'Notificações', icon: 'notifications', route: '/notifications' },
    { label: 'Importações', icon: 'upload_file', route: '/imports' },
    { label: 'Assistente', icon: 'psychology', route: '/assistant' },
    { label: 'Metas', icon: 'target', route: '/goals' },
    { label: 'Configurações', icon: 'tune', route: '/settings' },
  ];

  protected toggleTools() {
    this.toolsExpanded.update((value) => !value);
  }
}
