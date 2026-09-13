import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    if (!this.authService.hasStoredSessionHint()) {
      return;
    }

    this.authService
      .restoreSession()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((authenticated) => {
        if (authenticated && !this.authService.currentUser()) {
          this.authService.loadMe().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
        }
      });
  }
}
