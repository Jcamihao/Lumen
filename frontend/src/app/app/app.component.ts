import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../core/services/auth.service';
import { ThemeService } from '../core/services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  private readonly authService = inject(AuthService);
  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.themeService.mode();

    if (!this.authService.hasSession()) {
      return;
    }

    this.authService
      .restoreSession()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((authenticated) => {
        if (authenticated) {
          this.authService.loadMe().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
        }
      });
  }
}
