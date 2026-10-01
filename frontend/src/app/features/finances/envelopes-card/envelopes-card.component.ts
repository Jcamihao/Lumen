import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Output, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Envelope } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { readErrorMessage } from '../../../core/utils/http-error.utils';
import { formatCurrency } from '../../../core/utils/money.utils';
import { readPlanLimitAction, readPlanLimitMessage } from '../../../core/utils/plan-limit.utils';

/** Paleta simples: o usuario nao escolhe cor, cicla por aqui na criacao. */
const ENVELOPE_COLORS = ['#f18f01', '#006cd2', '#0f9d7a', '#7c5cff', '#ef4444', '#0ea5e9'];

@Component({
    selector: 'app-envelopes-card',
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './envelopes-card.component.html',
    styleUrls: ['./envelopes-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class EnvelopesCardComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  /** Avisa a pagina para recarregar a lista/seletor de transacoes quando um envelope muda. */
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly envelopes = signal<Envelope[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly busyId = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    monthlyAmount: [null as number | null, [Validators.required, Validators.min(0.01)]],
  });

  protected readonly currencyCode = () => this.authService.currentUser()?.preferredCurrency ?? 'BRL';

  constructor() {
    this.load();
  }

  /** Chamado pela pagina quando algo fora deste card pode ter mudado o saldo (ex.: nova transacao marcada com um envelope). */
  refresh() {
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.loadFailed.set(false);

    this.api
      .listEnvelopes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (envelopes) => {
          this.envelopes.set(envelopes);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadFailed.set(true);
        },
      });
  }

  protected openForm() {
    this.formOpen.set(true);
  }

  protected closeForm() {
    this.formOpen.set(false);
    this.form.reset({ name: '', monthlyAmount: null });
  }

  protected submit() {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const color = ENVELOPE_COLORS[this.envelopes().length % ENVELOPE_COLORS.length];

    this.saving.set(true);

    this.api
      .createEnvelope({ name: raw.name.trim(), color, monthlyAmount: Number(raw.monthlyAmount) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.closeForm();
          this.toast.success('Reserva criada.');
          this.load();
          this.changed.emit();
        },
        error: (error) => {
          this.saving.set(false);
          const message =
            readPlanLimitMessage(error) ?? readErrorMessage(error, 'Não foi possível criar a reserva agora.');
          const action = readPlanLimitAction(error);
          if (action) {
            this.toast.errorWithAction(message, action);
          } else {
            this.toast.error(message);
          }
        },
      });
  }

  protected togglePause(envelope: Envelope) {
    this.busyId.set(envelope.id);

    this.api
      .updateEnvelope(envelope.id, { isActive: !envelope.isActive })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.toast.success(envelope.isActive ? 'Reserva pausada.' : 'Reserva retomada.');
          this.load();
          this.changed.emit();
        },
        error: (error) => {
          this.busyId.set(null);
          const message = readPlanLimitMessage(error) ?? 'Não foi possível atualizar a reserva.';
          const action = readPlanLimitAction(error);
          if (action) {
            this.toast.errorWithAction(message, action);
          } else {
            this.toast.error(message);
          }
        },
      });
  }

  protected remove(envelope: Envelope) {
    if (
      !globalThis.confirm(
        `Excluir a reserva "${envelope.name}"? Os gastos já marcados com ela continuam na sua lista.`,
      )
    ) {
      return;
    }

    this.busyId.set(envelope.id);

    this.api
      .deleteEnvelope(envelope.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.toast.success('Reserva removida.');
          this.load();
          this.changed.emit();
        },
        error: () => {
          this.busyId.set(null);
          this.toast.error('Não foi possível remover a reserva.');
        },
      });
  }

  protected barPercent(envelope: Envelope) {
    if (envelope.deposited <= 0) return 0;
    return Math.min(Math.max((envelope.spent / envelope.deposited) * 100, 0), 100);
  }

  protected formatMoney(value: number) {
    return formatCurrency(value, this.currencyCode());
  }

  protected trackEnvelope(_index: number, envelope: Envelope) {
    return envelope.id;
  }
}
