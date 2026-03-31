import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { SidebarComponent } from '../sidebar/sidebar.component';

@Component({
  selector: 'app-workspace-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, BottomNavComponent],
  templateUrl: './workspace-shell.component.html',
  styleUrls: ['./workspace-shell.component.scss'],
})
export class WorkspaceShellComponent {
  protected readonly mobileSidebarOpen = signal(false);
  protected readonly routeAnimationFlip = signal(false);
  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  constructor() {
    let isFirstRoute = true;

    effect(() => {
      this.currentUrl();
      this.mobileSidebarOpen.set(false);

      if (isFirstRoute) {
        isFirstRoute = false;
        return;
      }

      this.routeAnimationFlip.update((value) => !value);
    });
  }

  protected openMobileSidebar() {
    this.mobileSidebarOpen.set(true);
  }

  protected closeMobileSidebar() {
    this.mobileSidebarOpen.set(false);
  }

  protected handleBottomNavNavigation() {
    this.closeMobileSidebar();
  }
}
