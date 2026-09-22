import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaymentMethod } from '../../core/models/domain.models';
import { PaymentMethodPickerComponent } from './payment-method-picker.component';

describe('PaymentMethodPickerComponent', () => {
  let fixture: ComponentFixture<PaymentMethodPickerComponent>;
  let emitted: Array<PaymentMethod | ''>;

  const buttons = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'));
  const click = (label: string) => buttons().find((b) => b.textContent?.includes(label))!.click();

  beforeEach(() => {
    fixture = TestBed.createComponent(PaymentMethodPickerComponent);
    emitted = [];
    fixture.componentInstance.valueChange.subscribe((value) => emitted.push(value));
    fixture.detectChanges();
  });

  it('mostra PIX, Credito e Debito, todos desmarcados no comeco', () => {
    expect(buttons().map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'bolt PIX',
      'credit_card Crédito',
      'payments Débito',
    ]);
    expect(buttons().every((b) => b.getAttribute('aria-checked') === 'false')).toBeTrue();
  });

  it('tocar numa opcao emite o valor', () => {
    click('Crédito');

    expect(emitted).toEqual(['CREDIT']);
  });

  it('tocar na opcao ja marcada desmarca (nao informado)', () => {
    fixture.componentRef.setInput('value', 'PIX');
    fixture.detectChanges();

    click('PIX');

    expect(emitted).toEqual(['']);
  });

  it('marca visualmente so a opcao escolhida', () => {
    fixture.componentRef.setInput('value', 'DEBIT');
    fixture.detectChanges();

    const checked = buttons().filter((b) => b.getAttribute('aria-checked') === 'true');
    expect(checked.length).toBe(1);
    expect(checked[0].textContent).toContain('Débito');
  });

  it('trocar de opcao emite a nova (sem passar por vazio)', () => {
    fixture.componentRef.setInput('value', 'PIX');
    fixture.detectChanges();

    click('Débito');

    expect(emitted).toEqual(['DEBIT']);
  });
});
