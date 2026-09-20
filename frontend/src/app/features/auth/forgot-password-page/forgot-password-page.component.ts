import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { readApiError } from '../auth-flow.utils';

@Component({
  selector: 'app-forgot-password-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password-page.component.html',
  styleUrls: ['../auth-flow.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly sent = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set('Informe um email válido.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.authService
      .forgotPassword({ email: this.form.getRawValue().email.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.sent.set(true);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(
            readApiError(error, 'Não foi possível enviar o email agora. Tente novamente.'),
          );
        },
      });
  }
}
