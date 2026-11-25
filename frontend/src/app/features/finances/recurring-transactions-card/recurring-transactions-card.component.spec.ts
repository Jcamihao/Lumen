import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { CreditCard, RecurringTransaction } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { RecurringTransactionsCardComponent } from './recurring-transactions-card.component';

const rule = (overrides: Partial<RecurringTransaction> = {}): RecurringTransaction => ({
  id: 'rule-1',
  type: 'EXPENSE',
  description: 'Internet',
  amount: 100,
  categoryId: null,
  category: null,
  paymentMethod: null,
  frequency: 'MONTHLY',
  anchorDay: 5,
  nextDueDate: '2027-01-05T00:00:00.000Z',
  isActive: true,
  ...overrides,
});

describe('RecurringTransactionsCardComponent (9c-1b)', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<RecurringTransactionsCardComponent>;
  const online = signal(true);

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const form = () => (fixture.componentInstance as unknown as { form: FormGroup }).form;
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
  const cardSelect = () => root().querySelector<HTMLSelectElement>('#recurring-card');
  const clickButton = (label: string) =>
    (Array.from(root().querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement).click();
  const openWith = (values: Record<string, unknown>) => {
    clickButton('Nova conta fixa');
    fixture.detectChanges();
    form().patchValue({ description: 'Internet', amount: 100, ...values });
    fixture.detectChanges();
  };
  const sentCardId = () => api.createRecurringTransaction.calls.mostRecent().args[0].cardId;

  beforeEach(() => {
    online.set(true);
    api = jasmine.createSpyObj('LifeApiService', [
      'listRecurringTransactions',
      'createRecurringTransaction',
      'deleteRecurringTransaction',
      'updateRecurringTransaction',
      'listCreditCards',
    ]);
    api.listRecurringTransactions.and.returnValue(of([]));
    api.listCreditCards.and.returnValue(of([]));
    api.createRecurringTransaction.and.returnValue(of(rule()));

    TestBed.configureTestingModule({
      imports: [RecurringTransactionsCardComponent],
      providers: [
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => ({ preferredCurrency: 'BRL', financeCategories: [] }) } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {}, errorWithAction: () => {} } },
        { provide: NetworkService, useValue: { isOnline: online.asReadonly() } },
      ],
    });
  });

  afterEach(() => online.set(true));

  const create = () => {
    fixture = TestBed.createComponent(RecurringTransactionsCardComponent);
    fixture.detectChanges();
  };

  it('despesa no credito com dois cartoes: seletor com o padrao e cardId na conta fixa', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    openWith({ paymentMethod: 'CREDIT' });

    expect(cardSelect()!.value).toBe('c-principal');
    clickButton('Criar conta fixa');
    expect(sentCardId()).toBe('c-principal');
  });

  it('receita: sem seletor e sem cardId, mesmo no credito', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    openWith({ type: 'INCOME', paymentMethod: 'CREDIT' });

    expect(cardSelect()).toBeNull();
    clickButton('Criar conta fixa');
    expect(sentCardId()).toBeUndefined();
  });

  it('debito: sem seletor e sem cardId', () => {
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    create();
    openWith({ paymentMethod: 'DEBIT' });

    expect(cardSelect()).toBeNull();
    clickButton('Criar conta fixa');
    expect(sentCardId()).toBeUndefined();
  });

  it('a lista mostra o cartao junto da forma de pagamento', () => {
    api.listRecurringTransactions.and.returnValue(of([rule({ paymentMethod: 'CREDIT', cardName: 'Nubank' })]));
    create();

    expect(text()).toContain('Crédito · Nubank');
  });
});
