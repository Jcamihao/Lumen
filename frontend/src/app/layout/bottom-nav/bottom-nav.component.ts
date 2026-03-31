import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

type NavItem = {
  label: string;
  icon: string;
  route?: string;
  action?: 'menu';
};

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.scss'],
})
export class BottomNavComponent implements OnDestroy {
  @Output() readonly menuRequested = new EventEmitter<void>();
  protected readonly animatingItemKey = signal<string | null>(null);
  private animationTimeoutId: ReturnType<typeof setTimeout> | null = null;

  protected readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'space_dashboard', route: '/dashboard' },
    { label: 'Tasks', icon: 'checklist', route: '/tasks' },
    { label: 'Finance', icon: 'account_balance_wallet', route: '/finances' },
    { label: 'Assist', icon: 'auto_awesome', route: '/assistant' },
    { label: 'Menu', icon: 'menu', action: 'menu' },
  ];

  protected handleMenuClick() {
    this.menuRequested.emit();
  }

  protected handleNavTap(item: NavItem) {
    const key = this.navKey(item);
    this.animatingItemKey.set(key);

    if (this.animationTimeoutId) {
      clearTimeout(this.animationTimeoutId);
    }

    this.animationTimeoutId = setTimeout(() => {
      if (this.animatingItemKey() === key) {
        this.animatingItemKey.set(null);
      }

      this.animationTimeoutId = null;
    }, 420);
  }

  protected navKey(item: NavItem) {
    return item.route ?? item.action ?? item.label;
  }

  ngOnDestroy() {
    if (this.animationTimeoutId) {
      clearTimeout(this.animationTimeoutId);
    }
  }
}
