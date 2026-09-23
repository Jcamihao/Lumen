import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, throwError } from 'rxjs';
import { CreditCycle } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { CreditCycleCardComponent } from './credit-cycle-card.component';

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

describe('CreditCycleCardComponent', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<CreditCycleCardComponent>;
  let current$: Subject<CreditCycle>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const clickText = (label: string) =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((btn) =>
      btn.textContent?.trim().includes(label),
    )!.click();

  const create = () => {
    fixture = TestBed.createComponent(CreditCycleCardComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    current$ = new Subject<CreditCycle>();
    api = jasmine.createSpyObj('LifeApiService', ['getCurrentCreditCycle']);
    api.getCurrentCreditCycle.and.returnValue(current$.asObservable());

    TestBed.configureTestingModule({
      imports: [CreditCycleCardComponent],
      providers: [
        provideRouter([]),
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => ({ preferredCurrency: 'BRL' }) } },
      ],
    });
  });

  it('mostra "carregando" antes da resposta', () => {
    create();

    expect(text()).toContain('Carregando');
  });

  it('sem teto definido, mostra o convite pra configurar no Cartão', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();

    expect(text()).toContain('Nenhum teto definido pra este ciclo');
    expect(text()).toContain('06 de set. a 05 de out.');
    expect(root().querySelector('a[href="/card"]')).not.toBeNull();
  });

  it('sugere o teto do ciclo anterior no convite', () => {
    create();
    current$.next(cycle({ previousCeiling: 1500 }));
    fixture.detectChanges();

    expect(text()).toContain('No ciclo passado era');
    expect(text()).toContain(money(1500));
  });

  it('com teto definido, mostra quanto ainda resta em destaque', () => {
    create();
    current$.next(cycle({ ceiling: 1600, spent: 900, remaining: 700, percentUsed: 56, status: 'ok' }));
    fixture.detectChanges();

    expect(root().querySelector('.credit-cycle-card__amount strong')?.textContent).toContain(money(700));
    expect(text()).toContain('56% usado');
  });

  it('perto do teto mostra o status "near" e passa do teto mostra "over"', () => {
    create();
    current$.next(cycle({ ceiling: 1000, spent: 850, remaining: 150, percentUsed: 85, status: 'near' }));
    fixture.detectChanges();
    expect(root().querySelector('.credit-cycle-card__body')?.getAttribute('data-status')).toBe('near');

    current$.next(cycle({ ceiling: 1000, spent: 1200, remaining: -200, percentUsed: 120, status: 'over' }));
    fixture.detectChanges();
    expect(root().querySelector('.credit-cycle-card__body')?.getAttribute('data-status')).toBe('over');
    expect(text()).toContain('Passou');
    expect(text()).toContain(money(200));
  });

  it('a barra nunca passa de 100% de largura, mesmo estourado', () => {
    create();
    current$.next(cycle({ ceiling: 1000, spent: 1500, remaining: -500, percentUsed: 150, status: 'over' }));
    fixture.detectChanges();

    const bar = root().querySelector<HTMLElement>('.credit-cycle-card__bar > span');
    expect(bar?.style.width).toBe('100%');
  });

  it('mostra o link "Configurar cartão" no cabeçalho', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();

    expect(root().querySelector('a[href="/card"]')?.textContent).toContain('Configurar cartão');
  });

  it('erro ao carregar mostra "tentar de novo" e refaz a chamada', () => {
    api.getCurrentCreditCycle.and.returnValue(throwError(() => new Error('falhou')));
    create();
    fixture.detectChanges();

    expect(text()).toContain('Não foi possível carregar');

    current$ = new Subject<CreditCycle>();
    api.getCurrentCreditCycle.and.returnValue(current$.asObservable());
    clickText('Tentar de novo');
    current$.next(cycle({ ceiling: 500, remaining: 500, percentUsed: 0, status: 'ok' }));
    fixture.detectChanges();

    expect(text()).toContain(money(500));
  });
});
