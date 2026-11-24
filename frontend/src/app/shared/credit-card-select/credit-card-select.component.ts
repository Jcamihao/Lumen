import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CreditCard } from '../../core/models/domain.models';
import { LifeApiService } from '../../core/services/life-api.service';
import { NetworkService } from '../../core/services/network.service';
import { activeCards, pickCardId } from '../../core/utils/credit-card.utils';

/** Seletor de cartao. Aparece so com despesa no credito, online e com 2+ cartoes ativos; senao o valor fica vazio. */
@Component({
  selector: 'app-credit-card-select',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './credit-card-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreditCardSelectComponent implements OnInit {
  private readonly api = inject(LifeApiService);
  private readonly network = inject(NetworkService);
  private readonly destroyRef = inject(DestroyRef);

  readonly control = input.required<FormControl<string>>();
  readonly enabled = input(false);
  readonly fieldId = input('credit-card-select');

  protected readonly cards = signal<CreditCard[]>([]);
  protected readonly activeCards = computed(() => activeCards(this.cards()));
  protected readonly visible = computed(
    () => this.enabled() && this.network.isOnline() && this.activeCards().length >= 2,
  );

  constructor() {
    this.loadCards();
    effect(() => this.reconcile());
  }

  ngOnInit() {
    this.control()
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reconcile());
  }

  private loadCards() {
    if (!this.network.isOnline()) {
      return;
    }

    this.api
      .listCreditCards()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cards) => this.cards.set(cards),
        error: () => this.cards.set([]),
      });
  }

  private reconcile() {
    const control = this.control();
    const next = pickCardId(control.value, this.cards(), this.enabled() && this.network.isOnline());

    if (next !== control.value) {
      control.setValue(next, { emitEvent: false });
    }
  }
}
