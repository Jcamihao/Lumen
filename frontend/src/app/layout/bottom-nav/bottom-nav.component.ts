import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.scss'],
})
export class BottomNavComponent {
  protected readonly navItems = [
    { label: 'Home', icon: 'space_dashboard', route: '/dashboard' },
    { label: 'Tasks', icon: 'checklist', route: '/tasks' },
    { label: 'Finance', icon: 'account_balance_wallet', route: '/finances' },
    { label: 'Goals', icon: 'flag', route: '/goals' },
    { label: 'Assist', icon: 'auto_awesome', route: '/assistant' },
    { label: 'Settings', icon: 'settings', route: '/settings' },
  ];
}
