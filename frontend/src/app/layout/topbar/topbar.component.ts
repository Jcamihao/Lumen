import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { Observable, filter, finalize, map, startWith } from 'rxjs';
import { Goal, Insight, Task, Transaction } from '../../core/models/domain.models';
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

  // --- Busca global (tarefas + transações + metas + insights + atalho pro Selah) ---
  private readonly searchTasks = signal<Task[]>([]);
  private readonly searchTransactions = signal<Transaction[]>([]);
  private readonly searchGoals = signal<Goal[]>([]);
  private readonly searchInsights = signal<Insight[]>([]);
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

  protected readonly goalResults = computed(() => {
    const term = this.normalizedQuery();
    if (term.length < 2) return [];

    return this.searchGoals()
      .filter((goal) => `${goal.title} ${goal.description ?? ''}`.toLowerCase().includes(term))
      .slice(0, MAX_RESULTS_PER_KIND);
  });

  protected readonly insightResults = computed(() => {
    const term = this.normalizedQuery();
    if (term.length < 2) return [];

    return this.searchInsights()
      .filter((insight) => insight.message.toLowerCase().includes(term))
      .slice(0, MAX_RESULTS_PER_KIND);
  });

  protected readonly hasMatches = computed(
    () =>
      this.taskResults().length > 0 ||
      this.transactionResults().length > 0 ||
      this.goalResults().length > 0 ||
      this.insightResults().length > 0,
  );

  /**
   * Os dados da busca (tarefas, transacoes inteiras, metas, insights) so sao
   * pedidos na primeira vez que o usuario foca o campo. Antes eram 4
   * requisicoes a cada abertura do app, disputando conexao com o dashboard.
   */
  private searchDataRequested = false;
  protected readonly searchDataLoading = signal(false);

  private loadSearchData() {
    if (this.searchDataRequested) {
      return;
    }

    this.searchDataRequested = true;
    this.searchDataLoading.set(true);

    let pending = 4;
    let failed = false;
    const load = <T>(source: Observable<T>, target: WritableSignal<T>) => {
      source
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          finalize(() => {
            pending -= 1;
            if (pending === 0) {
              this.searchDataLoading.set(false);
              // Falhou algo: deixa a proxima vez que o campo receber foco tentar de novo.
              this.searchDataRequested = !failed;
            }
          }),
        )
        .subscribe({
          next: (value) => target.set(value),
          error: () => {
            failed = true;
          },
        });
    };

    load(this.api.listTasks(), this.searchTasks);
    load(this.api.listTransactions(), this.searchTransactions);
    load(this.api.listGoals(), this.searchGoals);
    load(this.api.listInsights(), this.searchInsights);
  }

  protected onSearchFocus() {
    this.searchOpen.set(true);
    this.loadSearchData();
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

  protected goToGoal(_goal: Goal) {
    // Metas não têm busca/filtro na própria tela ainda, então não há
    // queryParam útil pra passar — só leva pra lá.
    this.router.navigate(['/goals']);
    this.closeSearch();
  }

  protected insightIcon(type: Insight['type']) {
    return { PRODUCTIVITY: 'checklist', FINANCE: 'account_balance_wallet', GOAL: 'flag', ROUTINE: 'routine' }[type];
  }

  private insightRoute(type: Insight['type']) {
    return { PRODUCTIVITY: '/tasks', FINANCE: '/finance', GOAL: '/goals', ROUTINE: '/tasks' }[type];
  }

  protected goToInsight(insight: Insight) {
    this.router.navigate([this.insightRoute(insight.type)]);
    this.closeSearch();
  }
}
