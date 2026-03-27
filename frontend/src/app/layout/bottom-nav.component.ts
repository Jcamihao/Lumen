import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <nav class="bottom-nav">
      <a
        *ngFor="let item of navItems"
        [routerLink]="item.route"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: item.route === '/dashboard' }"
      >
        <span class="material-symbols-rounded">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </a>
    </nav>
  `,
  styles: [`
    .bottom-nav {
      position: fixed;
      right: 1rem;
      bottom: 1rem;
      left: 1rem;
      z-index: 40;
      display: flex;
      gap: 0.35rem;
      padding: 0.6rem;
      border-radius: 1.6rem;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(229, 231, 235, 0.92);
      box-shadow: 0 22px 54px rgba(17, 17, 17, 0.14);
      backdrop-filter: blur(16px);
      overflow-x: auto;
      scrollbar-width: none;
    }

    .bottom-nav::-webkit-scrollbar {
      display: none;
    }

    :root[data-theme='dark'] .bottom-nav {
      background: rgba(18, 18, 18, 0.92);
      border-color: rgba(42, 42, 42, 0.92);
    }

    a {
      flex: 1 0 4.8rem;
      min-width: 4.8rem;
      display: grid;
      place-items: center;
      gap: 0.22rem;
      padding: 0.55rem 0.2rem;
      border-radius: 1rem;
      color: var(--text-secondary);
      font-size: 0.7rem;
      font-weight: 600;
      transition:
        color var(--transition-fast),
        background-color var(--transition-fast),
        transform var(--transition-fast);
    }

    a.active {
      background: rgba(99, 102, 241, 0.12);
      color: var(--accent);
      transform: translateY(-1px);
    }

    .material-symbols-rounded {
      font-size: 1.2rem;
    }

    @media (min-width: 900px) {
      .bottom-nav {
        display: none;
      }
    }
  `],
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
