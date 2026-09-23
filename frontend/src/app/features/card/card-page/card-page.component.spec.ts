import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { CreditCycle, User } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { CardPageComponent } from './card-page.component';

const cycle = (overrides: Partial<CreditCycle> = {}): CreditCycle => ({
  closingDay: 5,
  dueDay: null,
  countAllPayments: false,
  cycleStart: '2026-09-06T00:00:00.000Z',
  cycleEnd: '2026-10-05T00:00:00.000Z',
  ceiling: null,
  spent: 0,
  remaining: null,
  percentUsed: null,
  status: 'none',
  previousCeiling: null,
  ...overrides,
});

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

describe('CardPageComponent', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let authService: { currentUser: () => Partial<User>; updateStoredUser: jasmine.Spy };
  let fixture: ComponentFixture<CardPageComponent>;
  let current$: Subject<CreditCycle>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const setVal = (sel: string, value: string) => {
    const el = root().querySelector<HTMLInputElement>(sel)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };
  const submitForm = (fieldSel: string) => {
    root().querySelector<HTMLInputElement>(fieldSel)!.closest('form')!.requestSubmit();
  };

  beforeEach(() => {
    current$ = new Subject<CreditCycle>();
    api = jasmine.createSpyObj('LifeApiService', [
      'getCurrentCreditCycle',
      'setCreditCycleCeiling',
      'updateCreditCycleSettings',
      'updateUser',
    ]);
    api.getCurrentCreditCycle.and.returnValue(current$.asObservable());
    authService = {
      currentUser: () => ({ preferredCurrency: 'BRL', monthClosingDay: 10 }),
      updateStoredUser: jasmine.createSpy('updateStoredUser'),
    };

    TestBed.configureTestingModule({
      imports: [CardPageComponent],
      providers: [
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: authService },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    });
  });

  const create = () => {
    fixture = TestBed.createComponent(CardPageComponent);
    fixture.detectChanges();
  };

  it('mostra "carregando" antes da resposta', () => {
    create();

    expect(text()).toContain('Carregando');
  });

  it('com dado carregado, mostra o ciclo e quanto ainda resta', () => {
    create();
    current$.next(cycle({ ceiling: 1600, spent: 900, remaining: 700, percentUsed: 56, status: 'ok' }));
    fixture.detectChanges();

    expect(text()).toContain('06 de set. a 05 de out.');
    expect(text()).toContain(money(700));
  });

  it('dia de fechamento vem preenchido com o do usuario, mesmo antes do ciclo carregar', () => {
    create();

    expect(root().querySelector<HTMLInputElement>('#card-closing-day')?.value).toBe('10');
  });

  it('salvar o fechamento chama updateUser, atualiza o usuario local e recarrega o ciclo', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();
    api.updateUser.and.returnValue(of({ monthClosingDay: 15 } as User));
    const secondLoad$ = new Subject<CreditCycle>();
    api.getCurrentCreditCycle.and.returnValue(secondLoad$.asObservable());

    setVal('#card-closing-day', '15');
    submitForm('#card-closing-day');

    expect(api.updateUser).toHaveBeenCalledWith({ monthClosingDay: 15 });
    expect(authService.updateStoredUser).toHaveBeenCalledWith({ monthClosingDay: 15 });
    expect(api.getCurrentCreditCycle).toHaveBeenCalledTimes(2);
  });

  it('salvar o vencimento chama updateCreditCycleSettings com o dueDay', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();
    api.updateCreditCycleSettings.and.returnValue(of(cycle({ dueDay: 20 })));

    setVal('#card-due-day', '20');
    submitForm('#card-due-day');

    expect(api.updateCreditCycleSettings).toHaveBeenCalledWith({ dueDay: 20 });
  });

  it('salvar o teto chama setCreditCycleCeiling', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();
    api.setCreditCycleCeiling.and.returnValue(of(cycle({ ceiling: 1600 })));

    setVal('#card-ceiling', '1600');
    submitForm('#card-ceiling');

    expect(api.setCreditCycleCeiling).toHaveBeenCalledWith({ ceiling: 1600 });
  });

  it('o checkbox de escopo reflete countAllPayments e o clique chama a API certa', () => {
    create();
    current$.next(cycle({ countAllPayments: false }));
    fixture.detectChanges();

    const checkbox = root().querySelector<HTMLInputElement>('.card-page__scope-toggle input')!;
    expect(checkbox.checked).toBeFalse();

    api.updateCreditCycleSettings.and.returnValue(of(cycle({ countAllPayments: true })));
    checkbox.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(api.updateCreditCycleSettings).toHaveBeenCalledWith({ countAllPayments: true });
  });

  it('erro ao carregar mostra "tentar de novo" e refaz a chamada', () => {
    api.getCurrentCreditCycle.and.returnValue(throwError(() => new Error('falhou')));
    create();

    expect(text()).toContain('Não foi possível carregar o ciclo atual');

    current$ = new Subject<CreditCycle>();
    api.getCurrentCreditCycle.and.returnValue(current$.asObservable());
    const button = Array.from(root().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Tentar de novo',
    ) as HTMLButtonElement;
    button.click();
    current$.next(cycle({ ceiling: 500, remaining: 500, percentUsed: 0, status: 'ok' }));
    fixture.detectChanges();

    expect(text()).toContain(money(500));
  });
});
