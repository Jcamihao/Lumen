import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

type NavItem = {
  label: string;
  icon: string;
  route: string;
};

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <aside class="sidebar">
      <a class="brand" routerLink="/dashboard">
        <span class="brand-mark">
          <img class="brand-logo" src="assets/logo/logo_lumen.png" alt="LUMEN">
        </span>
        <span class="brand-tagline">Clareza para sua vida</span>
      </a>

      <nav class="nav">
        <a
          *ngFor="let item of navItems"
          class="nav-link"
          [routerLink]="item.route"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: item.route === '/dashboard' }"
        >
          <span class="material-symbols-rounded">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </a>
      </nav>

      <section class="sidebar-card">
        <p class="section-kicker">Lumen Flow</p>
        <strong>Organize tarefas, finanças e metas no mesmo pulso.</strong>
        <span>Uma visão mais limpa para decidir o que vem agora.</span>
      </section>
    </aside>
  `,
  styles: [`
    .sidebar {
      position: sticky;
      top: 1.25rem;
      display: grid;
      gap: 1.75rem;
      min-height: calc(100vh - 2.5rem);
      padding: 1.5rem 1.15rem;
      border-radius: 2rem;
      background:
        radial-gradient(circle at top left, rgba(129, 140, 248, 0.18), transparent 28%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 26%),
        var(--sidebar);
      box-shadow: var(--shadow-float);
      color: var(--sidebar-text);
    }

    .brand {
      display: grid;
      gap: 0.75rem;
      padding: 0.4rem 0.55rem 0.4rem 0.35rem;
    }

    .brand-mark {
      display: inline-flex;
      width: min(100%, 10.75rem);
      padding: 0;
      border-radius: 1.35rem;
      overflow: hidden;
      box-shadow: 0 18px 32px rgba(0, 0, 0, 0.28);
    }

    .brand-logo {
      display: block;
      width: 100%;
      height: auto;
    }

    .brand-tagline {
      color: var(--sidebar-muted);
      font-size: 0.92rem;
      line-height: 1.45;
      max-width: 12rem;
    }

    .nav {
      display: grid;
      gap: 0.4rem;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      padding: 0.92rem 0.95rem;
      border-radius: 1.15rem;
      color: var(--sidebar-muted);
      transition:
        background-color var(--transition-fast),
        color var(--transition-fast),
        transform var(--transition-fast);
    }

    .nav-link:hover,
    .nav-link.active {
      background: rgba(99, 102, 241, 0.16);
      color: #ffffff;
      transform: translateX(2px);
    }

    .material-symbols-rounded {
      font-size: 1.25rem;
    }

    .sidebar-card {
      margin-top: auto;
      display: grid;
      gap: 0.65rem;
      padding: 1.1rem;
      border-radius: 1.4rem;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(18px);
    }

    .sidebar-card .section-kicker {
      color: rgba(255, 255, 255, 0.68);
    }

    .sidebar-card strong {
      color: #ffffff;
      font-size: 1.02rem;
      line-height: 1.35;
    }

    .sidebar-card span {
      color: var(--sidebar-muted);
      font-size: 0.9rem;
      line-height: 1.5;
    }
  `],
})
export class SidebarComponent {
  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', route: '/dashboard' },
    { label: 'Tasks', icon: 'checklist', route: '/tasks' },
    { label: 'Finance', icon: 'account_balance_wallet', route: '/finances' },
    { label: 'Goals', icon: 'flag', route: '/goals' },
    { label: 'Assistant', icon: 'auto_awesome', route: '/assistant' },
    { label: 'Settings', icon: 'settings', route: '/settings' },
  ];
}
