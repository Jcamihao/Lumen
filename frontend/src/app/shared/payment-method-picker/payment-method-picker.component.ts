import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { PaymentMethod } from '../../core/models/domain.models';
import { PAYMENT_METHODS } from '../../core/utils/payment-method.utils';

/**
 * Escolha opcional de PIX, credito ou debito. Tocar na opcao marcada desmarca
 * ("nao informado"): sem uma quarta opcao so para dizer que nao quer escolher.
 */
@Component({
    selector: 'app-payment-method-picker',
    imports: [CommonModule],
    templateUrl: './payment-method-picker.component.html',
    styleUrls: ['./payment-method-picker.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PaymentMethodPickerComponent {
  protected readonly options = PAYMENT_METHODS;

  /** '' = nao informado. */
  @Input() value: PaymentMethod | '' = '';
  /** Nome do campo, para o rotulo de acessibilidade. */
  @Input() ariaLabel = 'Forma de pagamento';
  @Output() readonly valueChange = new EventEmitter<PaymentMethod | ''>();

  protected select(method: PaymentMethod) {
    this.valueChange.emit(this.value === method ? '' : method);
  }
}
