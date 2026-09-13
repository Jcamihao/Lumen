import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { NotificationCenterService } from '../../core/services/notification-center.service';

type BreadcrumbItem = {
  label: string;
  route: string;
  exact?: boolean;
};

const BREADCRUMB_ITEMS: BreadcrumbItem[] = [
  { label: 'Início', route: '/dashboard', exact: true },
  { label: 'Tarefas', route: '/tasks' },
  { label: 'Finanças', route: '/finance' },
  { label: 'Metas', route: '/goals' },
  { label: 'Selah', route: '/assistant' },
  { label: 'Alertas', route: '/notifications' },
  { label: 'Importar', route: '/imports' },
  { label: 'Configurações', route: '/settings' },
  { label: 'Ajuda', route: '/support' },
  { label: 'Suporte administrativo', route: '/admin/support' },
];

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent {
  protected readonly authService = inject(AuthService);
  protected readonly notificationCenter = inject(NotificationCenterService);
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly currentPageLabel = computed(() => {
    const url = this.currentUrl();
    const match = BREADCRUMB_ITEMS.find((item) =>
      item.exact
        ? url === item.route || (item.route === '/dashboard' && url === '/')
        : url === item.route || url.startsWith(`${item.route}/`),
    );

    return match?.label ?? 'Workspace';
  });

  protected readonly userInitials = computed(() => {
    const name = this.authService.currentUser()?.name ?? '';
    return name.slice(0, 2).toUpperCase() || 'LU';
  });
}
