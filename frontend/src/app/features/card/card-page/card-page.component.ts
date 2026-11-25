import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { CreditCard, CreditCardReceipt, CreditCycle, User } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatDayLabel } from '../../../core/utils/date.utils';
import { formatCurrency } from '../../../core/utils/money.utils';

/** Teto tecnico de cartoes ativos por usuario (igual ao do backend). */
export const MAX_ACTIVE_CARDS = 10;

const OFFLINE_TEXT =
  'Sem conexão: criar e editar cartões só funciona online. Seus cartões aparecem quando a conexão voltar.';
const DEFAULT_ARCHIVE_HINT = 'Torne outro cartão padrão antes de arquivar.';
const LIMIT_TEXT = `Você já tem ${MAX_ACTIVE_CARDS} cartões ativos. Arquive um para criar outro.`;

/** Rejeita nome so com espacos (o backend apara e exige 1 a 40). */
const nonBlank: ValidatorFn = (control) =>
  typeof control.value === 'string' && control.value.trim().length === 0 ? { blank: true } : null;

/**
 * Cartoes de credito do usuario: lista, criar, editar (nome, fechamento,
 * vencimento), tornar padrao e arquivar. Abaixo, o ciclo do cartao padrao
 * (teto e escopo), que continua aqui como antes.
 */
@Component({
    selector: 'app-card-page',
    imports: [NgTemplateOutlet, ReactiveFormsModule],
    templateUrl: './card-page.component.html',
    styleUrls: ['./card-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CardPageComponent {
  private readonly api = inject(LifeApiService);
  protected readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly offlineText = OFFLINE_TEXT;
  protected readonly limitText = LIMIT_TEXT;
  protected readonly archiveHint = DEFAULT_ARCHIVE_HINT;
  protected readonly offline = this.api.offlineMode;

  // Lista de cartoes
  protected readonly cards = signal<CreditCard[]>([]);
  protected readonly cardsLoading = signal(true);
  protected readonly cardsFailed = signal(false);
  protected readonly showArchived = signal(false);
  protected readonly listError = signal<string | null>(null);
  protected readonly busyCardId = signal<string | null>(null);
  protected readonly confirmArchiveId = signal<string | null>(null);

  // Formulario (criar ou editar um cartao por vez)
  protected readonly mode = signal<'idle' | 'create' | 'edit'>('idle');
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly activeCards = computed(() => this.cards().filter((card) => !card.archivedAt));
  protected readonly visibleCards = computed(() =>
    this.showArchived() ? this.cards() : this.activeCards(),
  );
  protected readonly atLimit = computed(() => this.activeCards().length >= MAX_ACTIVE_CARDS);

  protected readonly cardForm = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(40), nonBlank],
    }),
    closingDay: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(1),
      Validators.max(31),
    ]),
    dueDay: new FormControl<number | null>(null, [Validators.min(1), Validators.max(31)]),
  });

  // Ciclo do cartao padrao (teto e escopo)
  protected readonly cycle = signal<CreditCycle | null>(null);
  protected readonly cycleLoading = signal(true);
  protected readonly cycleFailed = signal(false);
  protected readonly savingCycle = signal(false);

  protected readonly ceilingControl = new FormControl<number | null>(null, [
    Validators.required,
    Validators.min(0.01),
  ]);

  protected readonly currencyCode = () => this.authService.currentUser()?.preferredCurrency ?? 'BRL';

  constructor() {
    this.loadCards();
    this.loadCycle();
  }

  protected loadCards() {
    this.cardsLoading.set(true);
    this.cardsFailed.set(false);

    this.api
      .listCreditCards(this.showArchived())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cards) => {
          this.cards.set(cards);
          this.cardsLoading.set(false);
        },
        error: () => {
          this.cardsLoading.set(false);
          this.cardsFailed.set(true);
        },
      });
  }

  protected toggleArchived() {
    this.showArchived.update((value) => !value);
    this.confirmArchiveId.set(null);
    this.loadCards();
  }

  protected loadCycle() {
    this.cycleLoading.set(true);
    this.cycleFailed.set(false);

    this.api
      .getCurrentCreditCycle()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycle) => {
          this.cycle.set(cycle);
          this.ceilingControl.setValue(cycle.ceiling ?? cycle.previousCeiling ?? null);
          this.cycleLoading.set(false);
        },
        error: () => {
          this.cycleLoading.set(false);
          this.cycleFailed.set(true);
        },
      });
  }

  // ---- Criar / editar ----

  protected startCreate() {
    if (this.offline() || this.atLimit()) return;

    this.mode.set('create');
    this.editingId.set(null);
    this.formError.set(null);
    this.cardForm.reset({ name: '', closingDay: null, dueDay: null });
  }

  protected startEdit(card: CreditCard) {
    if (this.offline() || card.archivedAt) return;

    this.mode.set('edit');
    this.editingId.set(card.id);
    this.formError.set(null);
    this.confirmArchiveId.set(null);
    this.cardForm.reset({ name: card.name, closingDay: card.closingDay, dueDay: card.dueDay });
  }

  protected cancelForm() {
    this.mode.set('idle');
    this.editingId.set(null);
    this.formError.set(null);
  }

  protected submitForm() {
    if (this.offline()) {
      this.formError.set(OFFLINE_TEXT);
      return;
    }
    if (this.cardForm.invalid || this.saving()) {
      this.cardForm.markAllAsTouched();
      return;
    }

    const raw = this.cardForm.getRawValue();
    const payload = {
      name: raw.name.trim(),
      closingDay: Number(raw.closingDay),
      dueDay: raw.dueDay === null ? null : Number(raw.dueDay),
    };
    const creating = this.mode() === 'create';
    const id = this.editingId();

    this.saving.set(true);
    this.formError.set(null);

    const request$ = creating || !id
      ? this.api.createCreditCard(payload)
      : this.api.updateCreditCard(id, payload);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (receipt) => {
        this.saving.set(false);
        this.cancelForm();
        this.syncDefaultReceipt(receipt);
        this.toast.success(creating ? 'Cartão criado.' : 'Cartão salvo.');
        this.loadCards();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.formError.set(this.errorText(error));
        if (this.isNotFound(error)) this.loadCards();
      },
    });
  }

  // ---- Padrao e arquivar ----

  protected makeDefault(card: CreditCard) {
    if (this.offline() || card.isDefault || card.archivedAt || this.busyCardId()) return;

    this.busyCardId.set(card.id);
    this.listError.set(null);

    this.api
      .makeDefaultCreditCard(card.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (receipt) => {
          this.busyCardId.set(null);
          this.syncDefaultReceipt(receipt);
          this.toast.success(`${receipt.name} agora é o cartão padrão.`);
          this.loadCards();
        },
        error: (error: unknown) => {
          this.busyCardId.set(null);
          this.listError.set(this.errorText(error));
          if (this.isNotFound(error)) this.loadCards();
        },
      });
  }

  /** Primeiro clique: pede confirmacao. Arquivar nunca acontece com um clique so. */
  protected askArchive(card: CreditCard) {
    if (this.offline() || card.isDefault || card.archivedAt) return;
    this.confirmArchiveId.set(card.id);
  }

  protected cancelArchive() {
    this.confirmArchiveId.set(null);
  }

  protected confirmArchive(card: CreditCard) {
    if (this.offline() || card.isDefault || card.archivedAt || this.busyCardId()) return;

    this.busyCardId.set(card.id);
    this.listError.set(null);

    this.api
      .archiveCreditCard(card.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (receipt) => {
          this.busyCardId.set(null);
          this.confirmArchiveId.set(null);
          this.toast.success(`${receipt.name} arquivado.`);
          this.loadCards();
        },
        error: (error: unknown) => {
          this.busyCardId.set(null);
          this.confirmArchiveId.set(null);
          this.listError.set(this.errorText(error));
          if (this.isNotFound(error)) this.loadCards();
        },
      });
  }

  // ---- Ciclo do cartao padrao ----

  protected saveCeiling() {
    if (this.ceilingControl.invalid || this.savingCycle()) {
      this.ceilingControl.markAsTouched();
      return;
    }

    this.savingCycle.set(true);

    this.api
      .setCreditCycleCeiling({ ceiling: Number(this.ceilingControl.value) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycle) => {
          this.cycle.set(cycle);
          this.savingCycle.set(false);
          this.toast.success('Teto do ciclo salvo.');
        },
        error: () => {
          this.savingCycle.set(false);
          this.toast.error('Não foi possível salvar o teto agora.');
        },
      });
  }

  protected toggleCountAllPayments() {
    const current = this.cycle();
    if (!current || this.savingCycle()) return;

    const next = !current.countAllPayments;
    this.savingCycle.set(true);

    this.api
      .updateCreditCycleSettings({ countAllPayments: next })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cycle) => {
          this.cycle.set(cycle);
          this.savingCycle.set(false);
          this.toast.success(
            next ? 'Agora o teto soma crédito, débito e PIX.' : 'Agora o teto soma só o crédito.',
          );
        },
        error: () => {
          this.savingCycle.set(false);
          this.toast.error('Não foi possível salvar agora.');
        },
      });
  }

  // ---- Textos e validacao ----

  protected nameError() {
    const control = this.cardForm.controls.name;
    if (!control.touched || control.valid) return null;
    if (control.hasError('maxlength')) return 'Use até 40 caracteres.';
    return 'Dê um nome ao cartão.';
  }

  protected dayError(field: 'closingDay' | 'dueDay') {
    const control = this.cardForm.controls[field];
    if (!control.touched || control.valid) return null;
    return 'Use um dia de 1 a 31.';
  }

  protected cycleRangeLabel(cycle: CreditCycle) {
    return `${formatDayLabel(cycle.cycleStart, { day: '2-digit', month: 'short' })} a ${formatDayLabel(cycle.cycleEnd, { day: '2-digit', month: 'short' })}`;
  }

  protected statusText(cycle: CreditCycle) {
    if (cycle.status === 'none') {
      return 'Nenhum teto definido pra este ciclo ainda.';
    }
    if (cycle.status === 'over') {
      return `Passou ${this.formatMoney(Math.abs(cycle.remaining ?? 0))} do teto (${cycle.percentUsed}%)`;
    }

    return `${cycle.percentUsed}% usado · restam ${this.formatMoney(cycle.remaining ?? 0)}`;
  }

  protected formatMoney(value: number) {
    return formatCurrency(value, this.currencyCode());
  }

  /** Mensagem de erro da API em portugues; o formulario preserva o que foi digitado. */
  private errorText(error: unknown) {
    switch (this.statusOf(error)) {
      case 400:
        return 'Confira os dados: nome de 1 a 40 caracteres e dias de 1 a 31.';
      case 404:
        return 'Este cartão não existe mais. A lista foi atualizada.';
      case 409:
        return 'Já existe um cartão com este nome. Escolha outro.';
      case 422:
        return LIMIT_TEXT;
      default:
        return 'Não foi possível salvar agora. Tente de novo.';
    }
  }

  private isNotFound(error: unknown) {
    return this.statusOf(error) === 404;
  }

  private statusOf(error: unknown) {
    return error instanceof HttpErrorResponse ? error.status : 0;
  }

  /** Se o cartao escrito virou o padrao, o fechamento do usuario local e o ciclo acompanham. */
  private syncDefaultReceipt(receipt: CreditCardReceipt) {
    if (!receipt.isDefault) return;

    const user = this.authService.currentUser();
    if (user) {
      this.authService.updateStoredUser({ ...user, monthClosingDay: receipt.closingDay } as User);
    }
    this.loadCycle();
  }
}
