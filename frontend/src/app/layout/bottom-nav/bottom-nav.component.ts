import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

type NavItem = {
  label: string;
  icon: string;
  route: string;
  aliases?: string[];
  exact?: boolean;
};

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.scss'],
})
export class BottomNavComponent {
  private readonly menuOpenState = signal(false);

  @Input()
  set menuOpen(value: boolean) {
    this.menuOpenState.set(value);
  }

  get menuOpen() {
    return this.menuOpenState();
  }

  @Output() readonly menuRequested = new EventEmitter<void>();
  @Output() readonly navigationRequested = new EventEmitter<void>();

  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', route: '/dashboard', exact: true },
    { label: 'Tarefas', icon: 'checklist', route: '/tasks' },
    { label: 'Finança', icon: 'account_balance_wallet', route: '/finance', aliases: ['/finances'] },
    { label: 'Selah IA', icon: 'auto_awesome', route: '/assistant' },
  ];
  protected readonly menuIndex = this.navItems.length;
  protected readonly navSlotCount = this.navItems.length + 1;
  protected readonly activeIndex = computed(() => {
    if (this.menuOpenState()) {
      return this.menuIndex;
    }

    const url = this.currentUrl();
    const matchedIndex = this.navItems.findIndex((item) => this.matchesRoute(url, item));
    return matchedIndex === -1 ? this.menuIndex : matchedIndex;
  });

  protected requestMenu() {
    this.menuRequested.emit();
  }

  protected requestNavigation() {
    this.navigationRequested.emit();
  }

  protected isMenuActive() {
    return this.activeIndex() === this.menuIndex;
  }

  private matchesRoute(url: string, item: NavItem) {
    const candidates = [item.route, ...(item.aliases ?? [])];

    return candidates.some((candidate) => {
      if (item.exact) {
        return url === candidate || (candidate === '/dashboard' && url === '/');
      }

      return url === candidate || url.startsWith(`${candidate}/`);
    });
  }
}
