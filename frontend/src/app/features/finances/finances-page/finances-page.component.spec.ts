import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { ActivatedRoute, convertToParamMap, provideRouter, RouterLink } from '@angular/router';
import { WritableSignal, signal } from '@angular/core';
import { of } from 'rxjs';
import { CreditCard, Transaction } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CreditCardSelectComponent } from '../../../shared/credit-card-select/credit-card-select.component';
import { PaymentMethodPickerComponent } from '../../../shared/payment-method-picker/payment-method-picker.component';
import { FinancesPageComponent } from './finances-page.component';

const card = (overrides: Partial<CreditCard> = {}): CreditCard => ({
  id: 'c-principal',
  name: 'Principal',
  closingDay: 5,
  dueDay: null,
  countAllPayments: false,
  isDefault: true,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
const nubank = card({ id: 'c-nubank', name: 'Nubank', isDefault: false });

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  type: 'EXPENSE',
  description: 'Mercado',
  amount: 50,
  date: '2026-11-10',
  category: null,
  paymentMethod: 'CREDIT',
  cardName: 'Nubank',
  ...overrides,
});

describe('FinancesPageComponent - cartao no lancamento e filtro (9c-1b)', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<FinancesPageComponent>;
  const online = signal(true);

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const page = () => fixture.componentInstance as unknown as { form: FormGroup };
  const cardSelect = () => root().querySelector<HTMLSelectElement>('#transaction-card');
  const cardFilter = () => root().querySelector<HTMLSelectElement>('select[aria-label="Filtrar por cartão"]');
  const submitForm = () => {
    root().querySelector('#transaction-description')!.closest('form')!.dispatchEvent(new Event('submit'));
  };
  const sentCardId = () => api.createTransaction.calls.mostRecent().args[0]['cardId'];

  beforeEach(() => {
    online.set(true);
    api = jasmine.createSpyObj('LifeApiService', ['listTransactions', 'listEnvelopes', 'createTransaction', 'listCreditCards']);
    api.listTransactions.and.returnValue(of([]));
    api.listEnvelopes.and.returnValue(of([]));
    api.listCreditCards.and.returnValue(of([]));
    api.createTransaction.and.returnValue(of(transaction()));

    TestBed.configureTestingModule({
      imports: [CommonModule, ReactiveFormsModule, RouterLink, FinancesPageComponent],
      providers: [
        provideRouter([]),
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => ({ preferredCurrency: 'BRL', financeCategories: [] }) } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {}, errorWithAction: () => {} } },
        { provide: NetworkService, useValue: { isOnline: online.asReadonly() } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
      ],
    });
    TestBed.overrideComponent(FinancesPageComponent, {
      set: {
        imports: [CommonModule, ReactiveFormsModule, RouterLink, PaymentMethodPickerComponent, CreditCardSelectComponent],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
  });

  afterEach(() => online.set(true));

  const create = () => {
    fixture = TestBed.createComponent(FinancesPageComponent);
    fixture.detectChanges();
  };
  const fill = (values: Record<string, unknown>) => {
    page().form.patchValue({ description: 'Mercado', amount: 50, ...values });
    fixture.detectChanges();
  };

  it('dois cartoes e despesa no credito: seletor com o padrao e cardId no lancamento', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    fill({ paymentMethod: 'CREDIT' });

    expect(cardSelect()!.value).toBe('c-principal');
    submitForm();
    expect(sentCardId()).toBe('c-principal');
  });

  it('PIX: sem seletor e sem cardId', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    fill({ paymentMethod: 'PIX' });

    expect(cardSelect()).toBeNull();
    submitForm();
    expect(sentCardId()).toBeUndefined();
  });

  it('receita no credito: sem seletor e sem cardId', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    fill({ type: 'INCOME', paymentMethod: 'CREDIT' });

    expect(cardSelect()).toBeNull();
    submitForm();
    expect(sentCardId()).toBeUndefined();
  });

  it('um cartao so: sem seletor e sem cardId', () => {
    api.listCreditCards.and.returnValue(of([card()]));
    create();
    fill({ paymentMethod: 'CREDIT' });

    expect(cardSelect()).toBeNull();
    submitForm();
    expect(sentCardId()).toBeUndefined();
  });

  it('offline: sem seletor e sem cardId mesmo com cartoes carregados', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    fill({ paymentMethod: 'CREDIT' });
    online.set(false);
    fixture.detectChanges();

    expect(cardSelect()).toBeNull();
    submitForm();
    expect(sentCardId()).toBeUndefined();
  });

  it('filtro por cartao so com dois ou mais e envia o cardId na lista', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();

    expect(cardFilter()).not.toBeNull();
    cardFilter()!.value = 'c-nubank';
    cardFilter()!.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(api.listTransactions.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ cardId: 'c-nubank' }));
  });

  it('sem filtro de cartao quando ha um cartao so', () => {
    api.listCreditCards.and.returnValue(of([card()]));
    create();

    expect(cardFilter()).toBeNull();
  });

  it('busca por descricao tambem leva o filtro de cartao', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    (fixture.componentInstance as unknown as { filterSearch: WritableSignal<string> }).filterSearch.set('merc');
    fixture.detectChanges();

    cardFilter()!.value = 'c-nubank';
    cardFilter()!.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(api.listTransactions.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ search: 'merc', cardId: 'c-nubank' }),
    );
  });

  it('payload nunca leva cardId fora de despesa no credito, mesmo com o controle preenchido', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    fill({ paymentMethod: 'PIX' });
    page().form.controls['cardId'].setValue('c-nubank', { emitEvent: false });
    submitForm();

    expect(sentCardId()).toBeUndefined();
  });

  it('a lista mostra o nome do cartao', () => {
    api.listTransactions.and.returnValue(of([transaction()]));
    create();

    expect(text()).toContain('Nubank');
  });
});
