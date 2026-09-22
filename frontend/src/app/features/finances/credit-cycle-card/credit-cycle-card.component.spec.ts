import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { CreditCycle } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { CreditCycleCardComponent } from './credit-cycle-card.component';

const cycle = (overrides: Partial<CreditCycle> = {}): CreditCycle => ({
  closingDay: 5,
  dueDay: null,
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
    api = jasmine.createSpyObj('LifeApiService', [
      'getCurrentCreditCycle',
      'setCreditCycleCeiling',
      'updateCreditCycleSettings',
    ]);
    api.getCurrentCreditCycle.and.returnValue(current$.asObservable());

    TestBed.configureTestingModule({
      imports: [CreditCycleCardComponent],
      providers: [
        provideRouter([]),
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => ({ preferredCurrency: 'BRL' }) } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    });
  });

  it('mostra "carregando" antes da resposta', () => {
    create();

    expect(text()).toContain('Carregando');
  });

  it('sem teto definido, mostra o convite pra definir', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();

    expect(text()).toContain('Defina um teto para este ciclo');
    expect(text()).toContain('06 de set. a 05 de out.');
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

  it('definir o teto envia o valor e atualiza a tela', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();
    api.setCreditCycleCeiling.and.returnValue(of(cycle({ ceiling: 1600, remaining: 1600, percentUsed: 0, status: 'ok' })));

    clickText('Definir teto');
    fixture.detectChanges();
    const input = root().querySelector<HTMLInputElement>('#credit-ceiling')!;
    input.value = '1600';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickText('Salvar');

    expect(api.setCreditCycleCeiling).toHaveBeenCalledWith({ ceiling: 1600 });
    fixture.detectChanges();
    expect(text()).toContain(money(1600));
    expect(root().querySelector('#credit-ceiling')).toBeNull();
  });

  it('editar preenche o campo com o teto atual, nao com o vazio', () => {
    create();
    current$.next(cycle({ ceiling: 1600 }));
    fixture.detectChanges();

    clickText('Editar teto');
    fixture.detectChanges();

    expect(root().querySelector<HTMLInputElement>('#credit-ceiling')?.value).toBe('1600');
  });

  it('cancelar fecha o formulario sem enviar nada', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();

    clickText('Definir teto');
    fixture.detectChanges();
    clickText('Cancelar');
    fixture.detectChanges();

    expect(root().querySelector('#credit-ceiling')).toBeNull();
    expect(api.setCreditCycleCeiling).not.toHaveBeenCalled();
  });

  it('teto invalido (0 ou vazio) nao envia', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();
    clickText('Definir teto');
    fixture.detectChanges();

    clickText('Salvar');

    expect(api.setCreditCycleCeiling).not.toHaveBeenCalled();
  });

  it('dia de vencimento: sem informar mostra o convite; informado mostra o dia', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();
    expect(text()).toContain('Vencimento não informado');

    current$.next(cycle({ dueDay: 15 }));
    fixture.detectChanges();
    expect(text()).toContain('Vence dia 15');
  });

  it('salvar o vencimento chama a API certa', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();
    api.updateCreditCycleSettings.and.returnValue(of(cycle({ dueDay: 20 })));

    clickText('Informar');
    fixture.detectChanges();
    const input = root().querySelector<HTMLInputElement>('#credit-due-day')!;
    input.value = '20';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickText('Salvar vencimento');

    expect(api.updateCreditCycleSettings).toHaveBeenCalledWith({ dueDay: 20 });
  });

  it('mostra o dia de fechamento e o link para Configurações', () => {
    create();
    current$.next(cycle({ closingDay: 5 }));
    fixture.detectChanges();

    expect(text()).toContain('Fechamento dia 5');
    expect(root().querySelector('a[href="/settings"]')).not.toBeNull();
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

  it('erro ao salvar o teto mostra mensagem e mantem o formulario aberto', () => {
    create();
    current$.next(cycle());
    fixture.detectChanges();
    api.setCreditCycleCeiling.and.returnValue(throwError(() => new Error('falhou')));
    const toast = TestBed.inject(ToastService);
    const errorSpy = spyOn(toast, 'error');

    clickText('Definir teto');
    fixture.detectChanges();
    const input = root().querySelector<HTMLInputElement>('#credit-ceiling')!;
    input.value = '1600';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickText('Salvar');
    fixture.detectChanges();

    expect(errorSpy).toHaveBeenCalled();
    expect(root().querySelector('#credit-ceiling')).not.toBeNull();
  });
});
