import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  CURRENT_AI_CONSENT_VERSION,
  CURRENT_PRIVACY_NOTICE_VERSION,
} from '../../../core/constants/privacy.constants';
import { AUTH_PASSWORD_MIN_LENGTH } from '../../../core/constants/auth.constants';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register-page.component.html',
  styleUrls: ['./register-page.component.scss'],
})
export class RegisterPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly showPassword = signal(false);
  protected readonly avatarPreview = signal<string | null>(null);
  protected readonly privacyNoticeVersion = CURRENT_PRIVACY_NOTICE_VERSION;
  protected readonly aiConsentVersion = CURRENT_AI_CONSENT_VERSION;
  protected readonly passwordMinLength = AUTH_PASSWORD_MIN_LENGTH;

  protected readonly form = this.fb.nonNullable.group({
    name: ['Marina Costa', [Validators.required, Validators.minLength(2)]],
    email: ['marina@exemplo.com', [Validators.required, Validators.email]],
    password: [
      'Demo123!',
      [Validators.required, Validators.minLength(AUTH_PASSWORD_MIN_LENGTH)],
    ],
    avatarUrl: [''],
    monthlyIncome: [8500],
    monthClosingDay: [28],
    timezone: ['America/Sao_Paulo'],
    preferredCurrency: ['BRL'],
    privacyNoticeAccepted: [false, [Validators.requiredTrue]],
    aiAssistantEnabled: [false],
  });

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set('Aceite o aviso de privacidade para continuar.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    this.authService
      .register(this.form.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.router.navigate(['/dashboard']);
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(
            error?.error?.message ?? 'Não foi possível criar a conta.',
          );
        },
      });
  }

  protected handleAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      this.errorMessage.set("Selecione uma imagem válida para a foto de perfil.");
      input.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.errorMessage.set("A foto deve ter no máximo 2 MB.");
      input.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      this.form.patchValue({ avatarUrl: result });
      this.avatarPreview.set(result || null);
      this.errorMessage.set('');
    };
    reader.readAsDataURL(file);
  }

  protected clearAvatar(input: HTMLInputElement) {
    this.form.patchValue({ avatarUrl: '' });
    this.avatarPreview.set(null);
    input.value = '';
  }

  protected togglePasswordVisibility() {
    this.showPassword.update((value) => !value);
  }
}
