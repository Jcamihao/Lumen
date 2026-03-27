import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../core/services/auth.service';
import { ThemeService } from '../core/services/theme.service';
import { AppHeaderComponent } from './app-header.component';
import { BottomNavComponent } from './bottom-nav.component';
import { SidebarComponent } from './sidebar.component';

type RouteMeta = {
  eyebrow: string;
  title: string;
  subtitle: string;
  actionLabel: string;
  actionRoute: string;
};

@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    SidebarComponent,
    BottomNavComponent,
    AppHeaderComponent,
  ],
  template: `
    <div class="workspace-shell">
      <div class="sidebar-column">
        <app-sidebar></app-sidebar>
      </div>

      <main class="content-column">
        <div class="content-frame">
          <app-app-header
            [eyebrow]="currentMeta().eyebrow"
            [title]="currentMeta().title"
            [subtitle]="currentMeta().subtitle"
            [actionLabel]="currentMeta().actionLabel"
            [userName]="authService.currentUser()?.name || 'Você'"
            [themeMode]="themeService.mode()"
            (toggleTheme)="themeService.toggle()"
            (quickAction)="navigateTo(currentMeta().actionRoute)"
            (logout)="logout()"
          />

          <section class="page-content">
            <router-outlet></router-outlet>
          </section>
        </div>
      </main>

      <app-bottom-nav></app-bottom-nav>
    </div>
  `,
  styles: [`
    .workspace-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
      padding: 1rem;
    }

    .sidebar-column {
      display: none;
    }

    .content-column {
      min-width: 0;
    }

    .content-frame {
      width: min(100%, var(--page-width));
      margin: 0 auto;
    }

    .page-content {
      display: grid;
      gap: 1.5rem;
      padding-bottom: 1.5rem;
    }

    @media (max-width: 899px) {
      .workspace-shell {
        padding: 0.75rem;
      }

      .page-content {
        gap: 1rem;
        padding-bottom: 1rem;
      }
    }

    @media (min-width: 900px) {
      .workspace-shell {
        grid-template-columns: 280px minmax(0, 1fr);
        padding: 1.25rem;
      }

      .sidebar-column {
        display: block;
      }

      app-bottom-nav {
        display: none;
      }
    }
  `],
})
export class WorkspaceShellComponent {
  protected readonly authService = inject(AuthService);
  protected readonly themeService = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly currentMeta = computed(() => this.resolveMeta(this.currentUrl()));

  private resolveMeta(url: string): RouteMeta {
    if (url.startsWith('/tasks')) {
      return {
        eyebrow: 'Tasks',
        title: 'Tarefas conectadas',
        subtitle: 'Prioridades, prazos e impacto financeiro na mesma visão.',
        actionLabel: 'Nova tarefa',
        actionRoute: '/tasks',
      };
    }

    if (url.startsWith('/finances')) {
      return {
        eyebrow: 'Finance',
        title: 'Fluxo financeiro',
        subtitle: 'Entradas, saídas e contexto do seu mês sem ruído visual.',
        actionLabel: 'Nova entrada',
        actionRoute: '/finances',
      };
    }

    if (url.startsWith('/goals')) {
      return {
        eyebrow: 'Goals',
        title: 'Metas em movimento',
        subtitle: 'Objetivos com prazo, valor e progresso real no seu cotidiano.',
        actionLabel: 'Nova meta',
        actionRoute: '/goals',
      };
    }

    if (url.startsWith('/assistant')) {
      return {
        eyebrow: 'Assistant',
        title: 'Assistente de vida',
        subtitle: 'Peça prioridade, leitura financeira e próximos passos em linguagem clara.',
        actionLabel: 'Nova pergunta',
        actionRoute: '/assistant',
      };
    }

    if (url.startsWith('/imports')) {
      return {
        eyebrow: 'Imports',
        title: 'Importação inteligente',
        subtitle: 'Envie um CSV, visualize duplicidades e confirme com segurança.',
        actionLabel: 'Importar CSV',
        actionRoute: '/imports',
      };
    }

    if (url.startsWith('/settings')) {
      return {
        eyebrow: 'Settings',
        title: 'Preferências',
        subtitle: 'Ajuste seu workspace, renda base, moeda e clima visual.',
        actionLabel: 'Ajustar perfil',
        actionRoute: '/settings',
      };
    }

    return {
      eyebrow: 'Lumen',
      title: 'Dashboard da Vida',
      subtitle: 'Uma visão elegante do que pede atenção hoje em tarefas, dinheiro e objetivos.',
      actionLabel: 'Nova tarefa',
      actionRoute: '/tasks',
    };
  }

  protected navigateTo(route: string) {
    this.router.navigate([route]);
  }

  protected logout() {
    this.authService.logout();
  }
}
