import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
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
  host: {
    '[class.mobile-drawer]': 'mobile',
  },
})
export class SidebarComponent {
  @Input() mobile = false;
  @Output() readonly closeRequested = new EventEmitter<void>();

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
    { label: 'Suporte', icon: 'support_agent', route: '/support' },
    { label: 'Assistente', icon: 'psychology', route: '/assistant' },
    { label: 'Configurações', icon: 'tune', route: '/settings' },
  ];

  protected toggleTools() {
    this.toolsExpanded.update((value) => !value);
  }

  protected requestClose() {
    this.closeRequested.emit();
  }
}
