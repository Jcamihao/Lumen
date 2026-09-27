import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { readApiError } from '../auth-flow.utils';

const CATEGORY_LABEL: Record<string, string> = {
  weekly_digest: 'o resumo semanal',
  reminders: 'os lembretes por email',
  insight_alerts: 'os alertas por email',
};

@Component({
    selector: 'app-unsubscribe-page',
    imports: [CommonModule, RouterLink],
    templateUrl: './unsubscribe-page.component.html',
    styleUrls: ['../auth-flow.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class UnsubscribePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';

  protected readonly hasToken = !!this.token;
  protected readonly loading = signal(false);
  protected readonly categoryLabel = signal<string | null>(null);
  protected readonly errorMessage = signal('');

  // Confirmacao explicita (POST) em vez de agir ao abrir a pagina: scanners
  // de links de email nao devem descadastrar ninguem.
  protected confirm() {
    this.loading.set(true);
    this.errorMessage.set('');

    this.authService
      .unsubscribeEmail({ token: this.token })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          this.categoryLabel.set(CATEGORY_LABEL[response.category] ?? 'esses emails');
        },
        error: (error) => {
          this.loading.set(false);
          this.errorMessage.set(
            readApiError(error, 'Não foi possível concluir o descadastro. Tente de novo.'),
          );
        },
      });
  }
}
