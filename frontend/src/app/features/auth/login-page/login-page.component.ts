import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AUTH_PASSWORD_MIN_LENGTH } from '../../../core/constants/auth.constants';
import { LoginMfaChallengeResponse } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly showPassword = signal(false);
  protected readonly mfaChallenge = signal<LoginMfaChallengeResponse | null>(null);
  protected readonly passwordMinLength = AUTH_PASSWORD_MIN_LENGTH;

  protected readonly form = this.fb.nonNullable.group({
    email: ['demo@lumen.local', [Validators.required, Validators.email]],
    password: [
      'Demo123!',
      [Validators.required, Validators.minLength(AUTH_PASSWORD_MIN_LENGTH)],
    ],
  });
  protected readonly mfaForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected submit() {
    if (this.mfaChallenge()) {
      this.submitMfaCode();
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.authService
      .login(this.form.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          if ('requiresMfa' in response && response.requiresMfa) {
            this.mfaChallenge.set(response);
            this.mfaForm.reset({ code: '' });
            return;
          }

          this.router.navigate(['/dashboard']);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(error?.error?.message ?? 'Não foi possível entrar.');
        },
      });
  }

  protected submitMfaCode() {
    const challenge = this.mfaChallenge();

    if (!challenge) {
      return;
    }

    if (this.mfaForm.invalid) {
      this.mfaForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.authService
      .verifyLoginMfa({
        challengeId: challenge.challengeId,
        code: this.mfaForm.getRawValue().code,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.router.navigate(['/dashboard']);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(
            error?.error?.message ??
              'Não foi possível validar o código de autenticação.',
          );
        },
      });
  }

  protected togglePasswordVisibility() {
    this.showPassword.update((value) => !value);
  }

  protected resetMfaChallenge() {
    this.mfaChallenge.set(null);
    this.mfaForm.reset({ code: '' });
    this.errorMessage.set('');
  }

  protected mfaExpiresAtLabel() {
    const challengeExpiresAt = this.mfaChallenge()?.challengeExpiresAt;

    if (!challengeExpiresAt) {
      return '';
    }

    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(challengeExpiresAt));
  }
}
