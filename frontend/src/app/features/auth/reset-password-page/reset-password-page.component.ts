import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '../../../core/constants/auth.constants';
import { AuthService } from '../../../core/services/auth.service';
import { readApiError } from '../auth-flow.utils';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return password === confirm ? null : { mismatch: true };
}

@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password-page.component.html',
  styleUrls: ['../auth-flow.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly linkId = this.route.snapshot.queryParamMap.get('id') ?? '';
  private readonly linkToken = this.route.snapshot.queryParamMap.get('token') ?? '';

  protected readonly hasLink = !!this.linkId && !!this.linkToken;
  protected readonly passwordMinLength = AUTH_PASSWORD_MIN_LENGTH;
  protected readonly passwordMaxLength = AUTH_PASSWORD_MAX_LENGTH;
  protected readonly loading = signal(false);
  protected readonly done = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(AUTH_PASSWORD_MIN_LENGTH)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set(
        this.form.hasError('mismatch')
          ? 'As senhas não conferem.'
          : `A senha precisa ter no mínimo ${AUTH_PASSWORD_MIN_LENGTH} caracteres.`,
      );
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.authService
      .resetPassword({
        id: this.linkId,
        token: this.linkToken,
        password: this.form.getRawValue().password,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.done.set(true);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(
            readApiError(error, 'Não foi possível redefinir a senha. Peça um novo link.'),
          );
        },
      });
  }
}
