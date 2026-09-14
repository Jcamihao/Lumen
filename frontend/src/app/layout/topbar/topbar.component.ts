import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { Task, Transaction } from '../../core/models/domain.models';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { NotificationCenterService } from '../../core/services/notification-center.service';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

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

const MAX_RESULTS_PER_KIND = 5;

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, RouterLink, ThemeToggleComponent],
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent {
  protected readonly authService = inject(AuthService);
  protected readonly notificationCenter = inject(NotificationCenterService);
  private readonly api = inject(LifeApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

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

  protected readonly currencyCode = computed(
    () => this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );

  // --- Busca global (tarefas + transações + atalho pro Selah) ---
  private readonly searchTasks = signal<Task[]>([]);
  private readonly searchTransactions = signal<Transaction[]>([]);
  protected readonly searchQuery = signal('');
  protected readonly searchOpen = signal(false);

  private readonly normalizedQuery = computed(() => this.searchQuery().trim().toLowerCase());

  protected readonly taskResults = computed(() => {
    const term = this.normalizedQuery();
    if (term.length < 2) return [];

    return this.searchTasks()
      .filter((task) => `${task.title} ${task.description ?? ''}`.toLowerCase().includes(term))
      .slice(0, MAX_RESULTS_PER_KIND);
  });

  protected readonly transactionResults = computed(() => {
    const term = this.normalizedQuery();
    if (term.length < 2) return [];

    return this.searchTransactions()
      .filter((transaction) => transaction.description.toLowerCase().includes(term))
      .slice(0, MAX_RESULTS_PER_KIND);
  });

  protected readonly hasMatches = computed(
    () => this.taskResults().length > 0 || this.transactionResults().length > 0,
  );

  @ViewChild('searchInput') private readonly searchInputRef?: ElementRef<HTMLInputElement>;

  @HostListener('document:keydown', ['$event'])
  protected handleGlobalShortcut(event: KeyboardEvent) {
    const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
    if (!isShortcut) return;

    event.preventDefault();
    this.searchInputRef?.nativeElement.focus();
  }

  constructor() {
    this.api
      .listTasks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tasks) => this.searchTasks.set(tasks));

    this.api
      .listTransactions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((transactions) => this.searchTransactions.set(transactions));
  }

  protected onSearchFocus() {
    this.searchOpen.set(true);
  }

  protected onSearchBlur() {
    // Delay pra permitir o clique num resultado antes do dropdown fechar.
    setTimeout(() => this.searchOpen.set(false), 150);
  }

  protected closeSearch() {
    this.searchQuery.set('');
    this.searchOpen.set(false);
  }

  protected askSelahWithQuery() {
    const prompt = this.searchQuery().trim();
    if (!prompt) return;

    this.router.navigate(['/assistant'], {
      queryParams: { prompt, originModule: 'search' },
    });
    this.closeSearch();
  }

  protected goToTask(task: Task) {
    this.router.navigate(['/tasks'], { queryParams: { search: task.title } });
    this.closeSearch();
  }

  protected goToTransaction(transaction: Transaction) {
    this.router.navigate(['/finance'], { queryParams: { search: transaction.description } });
    this.closeSearch();
  }
}
