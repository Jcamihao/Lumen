import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { APP_VERSION } from '../../../core/app-version';
import { LifeApiService } from '../../../core/services/life-api.service';
import { buildDeviceInfo } from '../../../core/utils/device-info';
import {
  FEEDBACK_AREAS,
  FEEDBACK_MAX_FIELD,
  FEEDBACK_MIN_TEXT,
  FeedbackArea,
  RATING_OPTIONS,
  areaFromUrl,
  buildFeedbackMessage,
  feedbackSubject,
} from '../../../core/utils/feedback.utils';

type SentState = false | 'online' | 'offline';

@Component({
    selector: 'app-feedback-page',
    imports: [CommonModule, ReactiveFormsModule, RouterLink],
    templateUrl: './feedback-page.component.html',
    styleUrls: ['./feedback-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class FeedbackPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly areas = FEEDBACK_AREAS;
  protected readonly ratings = RATING_OPTIONS;
  protected readonly maxField = FEEDBACK_MAX_FIELD;

  protected readonly submitting = signal(false);
  protected readonly sent = signal<SentState>(false);
  protected readonly errorMessage = signal('');
  protected readonly showErrors = signal(false);

  // De onde o testador veio (a tela que ele estava usando): marca a area sozinho
  // e vai junto no feedback como contexto.
  private readonly originUrl =
    this.router.getCurrentNavigation()?.previousNavigation?.finalUrl?.toString() ?? null;

  protected readonly form = this.fb.nonNullable.group({
    // 0 = ainda nao escolheu.
    rating: [0, [Validators.min(1), Validators.max(5)]],
    area: [(this.originUrl ? areaFromUrl(this.originUrl) : 'GENERAL') as FeedbackArea],
    liked: ['', [Validators.maxLength(FEEDBACK_MAX_FIELD)]],
    improve: ['', [Validators.maxLength(FEEDBACK_MAX_FIELD)]],
    canContact: [false],
  });

  protected selectRating(value: number) {
    this.form.controls.rating.setValue(value);
    this.errorMessage.set('');
  }

  protected selectArea(value: FeedbackArea) {
    this.form.controls.area.setValue(value);
  }

  protected submit() {
    if (this.submitting()) {
      return;
    }

    const problem = this.problem();
    if (problem) {
      this.showErrors.set(true);
      this.errorMessage.set(problem);
      return;
    }

    const { rating, area, liked, improve, canContact } = this.form.getRawValue();

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api
      .createSupportRequest({
        type: 'FEEDBACK',
        subject: feedbackSubject(area, rating),
        message: buildFeedbackMessage(liked, improve),
        rating,
        area,
        canContact,
        screenPath: this.originUrl ?? '/feedback',
        appVersion: APP_VERSION,
        deviceInfo: buildDeviceInfo(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.submitting.set(false);
          // Sem rede o pedido fica na fila offline e sobe quando a conexao volta.
          this.sent.set(created.id.startsWith('offline-support-') ? 'offline' : 'online');
        },
        error: (error) => {
          this.submitting.set(false);
          this.errorMessage.set(
            error?.error?.message && typeof error.error.message === 'string'
              ? error.error.message
              : 'Não foi possível enviar agora. Seu texto continua aqui; tente de novo.',
          );
        },
      });
  }

  protected sendAnother() {
    this.form.reset({
      rating: 0,
      area: this.form.controls.area.value,
      liked: '',
      improve: '',
      canContact: this.form.controls.canContact.value,
    });
    this.sent.set(false);
    this.showErrors.set(false);
    this.errorMessage.set('');
  }

  protected ratingMissing() {
    return this.showErrors() && this.form.controls.rating.value < 1;
  }

  protected textMissing() {
    return this.showErrors() && this.writtenLength() < FEEDBACK_MIN_TEXT;
  }

  protected charsLeft(field: 'liked' | 'improve') {
    return this.maxField - this.form.controls[field].value.length;
  }

  /** So o que a pessoa escreveu: os rotulos das secoes nao contam para o minimo. */
  private writtenLength() {
    const { liked, improve } = this.form.getRawValue();
    return liked.trim().length + improve.trim().length;
  }

  /** Primeira coisa que impede o envio, ou null se esta tudo certo. */
  private problem() {
    if (this.form.controls.rating.value < 1) {
      return 'Escolha uma nota de 1 a 5.';
    }

    if (this.form.invalid) {
      return 'Um dos textos passou do limite de caracteres.';
    }

    if (this.writtenLength() < FEEDBACK_MIN_TEXT) {
      return 'Escreva pelo menos uma frase em "O que funcionou bem" ou em "O que atrapalhou ou faltou".';
    }

    return null;
  }
}
