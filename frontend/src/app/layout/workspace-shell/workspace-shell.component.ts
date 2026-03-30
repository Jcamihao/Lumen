import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { ThemeService } from '../../core/services/theme.service';
import { AppHeaderComponent } from '../app-header/app-header.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { SidebarComponent } from '../sidebar/sidebar.component';

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
  templateUrl: './workspace-shell.component.html',
  styleUrls: ['./workspace-shell.component.scss'],
  
})
export class WorkspaceShellComponent {
  protected readonly authService = inject(AuthService);
  protected readonly themeService = inject(ThemeService);
  protected readonly lifeApiService = inject(LifeApiService);
  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly currentMeta = computed(() =>
    this.resolveMeta(this.currentUrl()),
  );

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
        subtitle:
          'Objetivos com prazo, valor e progresso real no seu cotidiano.',
        actionLabel: 'Nova meta',
        actionRoute: '/goals',
      };
    }

    if (url.startsWith('/assistant')) {
      return {
        eyebrow: 'Assistant',
        title: 'Assistente de vida',
        subtitle:
          'Peça prioridade, leitura financeira e próximos passos em linguagem clara.',
        actionLabel: 'Nova pergunta',
        actionRoute: '/assistant',
      };
    }

    if (url.startsWith('/imports')) {
      return {
        eyebrow: 'Imports',
        title: 'Importação inteligente',
        subtitle:
          'Envie um CSV, visualize duplicidades e confirme com segurança.',
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
      subtitle:
        'Uma visão elegante do que pede atenção hoje em tarefas, dinheiro e objetivos.',
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
