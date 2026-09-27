import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { readApiError } from '../auth-flow.utils';

type VerifyState = 'loading' | 'success' | 'error';

@Component({
    selector: 'app-verify-email-page',
    imports: [CommonModule, RouterLink],
    templateUrl: './verify-email-page.component.html',
    styleUrls: ['../auth-flow.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class VerifyEmailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<VerifyState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly loggedIn = this.authService.isAuthenticated;

  ngOnInit() {
    const id = this.route.snapshot.queryParamMap.get('id');
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!id || !token) {
      this.errorMessage.set('Esse link de confirmação está incompleto.');
      this.state.set('error');
      return;
    }

    this.authService
      .verifyEmail({ id, token })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.state.set('success'),
        error: (error) => {
          this.errorMessage.set(
            readApiError(error, 'Não foi possível confirmar o email. O link pode ter expirado.'),
          );
          this.state.set('error');
        },
      });
  }
}
