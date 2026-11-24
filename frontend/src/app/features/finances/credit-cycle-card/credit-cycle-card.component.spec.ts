import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { CreditCard, CreditCycle } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { NetworkService } from '../../../core/services/network.service';
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
    api = jasmine.createSpyObj('LifeApiService', ['getCurrentCreditCycle', 'getCreditCardCycle', 'listCreditCards']);
    api.getCurrentCreditCycle.and.returnValue(current$.asObservable());
    api.listCreditCards.and.returnValue(of([]));

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

describe('CreditCycleCardComponent - um cartao por vez (9c-1b)', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<CreditCycleCardComponent>;
  let principal$: Subject<CreditCycle>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const tabs = () => Array.from(root().querySelectorAll<HTMLButtonElement>('[role="tab"]'));

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

  const create = () => {
    fixture = TestBed.createComponent(CreditCycleCardComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    principal$ = new Subject<CreditCycle>();
    api = jasmine.createSpyObj('LifeApiService', ['getCurrentCreditCycle', 'getCreditCardCycle', 'listCreditCards']);
    api.getCurrentCreditCycle.and.returnValue(of(cycle({ ceiling: 1000, remaining: 400, spent: 600, percentUsed: 60, status: 'ok' })));
    api.getCreditCardCycle.and.callFake((id: string) =>
      id === 'c-principal'
        ? principal$.asObservable()
        : of(cycle({ ceiling: 300, remaining: 123.45, spent: 176.55, percentUsed: 59, status: 'ok' })),
    );

    TestBed.configureTestingModule({
      imports: [CreditCycleCardComponent],
      providers: [
        provideRouter([]),
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => ({ preferredCurrency: 'BRL' }) } },
      ],
    });
  });

  it('um cartao so: sem abas e segue no ciclo do padrao', () => {
    api.listCreditCards.and.returnValue(of([card()]));
    principal$.complete();

    create();

    expect(tabs().length).toBe(0);
    expect(api.getCurrentCreditCycle).toHaveBeenCalled();
    expect(api.getCreditCardCycle).not.toHaveBeenCalled();
  });

  it('cartao arquivado nao vira aba', () => {
    api.listCreditCards.and.returnValue(of([card(), card({ id: 'c-antigo', name: 'Antigo', isDefault: false, archivedAt: '2026-02-01T00:00:00.000Z' })]));
    create();

    expect(tabs().length).toBe(0);
  });

  it('dois cartoes: abas com o padrao primeiro e selecionado, ciclo pelo id do padrao', () => {
    api.listCreditCards.and.returnValue(of([card({ id: 'c-nubank', name: 'Nubank', isDefault: false }), card()]));
    create();

    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(['Principal', 'Nubank']);
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(api.getCreditCardCycle).toHaveBeenCalledWith('c-principal');
    expect(api.getCurrentCreditCycle).not.toHaveBeenCalled();
  });

  it('clicar na aba ja selecionada nao recarrega o ciclo', () => {
    api.listCreditCards.and.returnValue(of([card({ id: 'c-nubank', name: 'Nubank', isDefault: false }), card()]));
    create();
    api.getCreditCardCycle.calls.reset();

    tabs()[0].click();
    fixture.detectChanges();

    expect(api.getCreditCardCycle).not.toHaveBeenCalled();
  });

  it('trocar de aba carrega o ciclo daquele cartao', () => {
    api.listCreditCards.and.returnValue(of([card({ id: 'c-nubank', name: 'Nubank', isDefault: false }), card()]));
    create();

    tabs()[1].click();
    fixture.detectChanges();

    expect(api.getCreditCardCycle).toHaveBeenCalledWith('c-nubank');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(text()).toContain(money(123.45));
  });

  it('resposta atrasada de um cartao nao sobrescreve o cartao escolhido depois', () => {
    api.listCreditCards.and.returnValue(of([card({ id: 'c-nubank', name: 'Nubank', isDefault: false }), card()]));
    create();

    tabs()[1].click();
    fixture.detectChanges();
    principal$.next(cycle({ ceiling: 999, remaining: 999, spent: 1, percentUsed: 0, status: 'ok' }));
    fixture.detectChanges();

    expect(text()).toContain(money(123.45));
    expect(text()).not.toContain(money(999));
  });
});

describe('CreditCycleCardComponent - escrita de teto por aba (9c-1b)', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<CreditCycleCardComponent>;
  const online = signal(true);

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const tabs = () => Array.from(root().querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const button = (label: string) =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === label);
  const input = () => root().querySelector<HTMLInputElement>('#credit-cycle-ceiling');
  const typeValue = (value: string) => {
    input()!.value = value;
    input()!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const submitForm = () => {
    root().querySelector('form.credit-cycle-card__form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };
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

  const create = () => {
    fixture = TestBed.createComponent(CreditCycleCardComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    online.set(true);
    api = jasmine.createSpyObj('LifeApiService', ['getCurrentCreditCycle', 'getCreditCardCycle', 'listCreditCards', 'setCreditCardCeiling']);
    api.getCurrentCreditCycle.and.returnValue(of(cycle({ ceiling: 1000, remaining: 400, spent: 600, percentUsed: 60, status: 'ok' })));
    api.getCreditCardCycle.and.callFake((id: string) =>
      of(cycle({ ceiling: id === 'c-principal' ? 1000 : null, previousCeiling: 500, remaining: 400, spent: 0, percentUsed: 0, status: 'ok' })),
    );
    api.listCreditCards.and.returnValue(of([nubank, card()]));
    api.setCreditCardCeiling.and.returnValue(of({ cardId: 'c-principal', refreshPending: false }));

    TestBed.configureTestingModule({
      imports: [CreditCycleCardComponent],
      providers: [
        provideRouter([]),
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => ({ preferredCurrency: 'BRL' }) } },
        { provide: NetworkService, useValue: { isOnline: online.asReadonly() } },
      ],
    });
  });

  afterEach(() => online.set(true));

  it('um cartao so: sem botao de teto (tela igual a de hoje)', () => {
    api.listCreditCards.and.returnValue(of([card()]));
    create();

    expect(button('Alterar teto')).toBeUndefined();
    expect(button('Definir teto')).toBeUndefined();
  });

  it('dois cartoes: "Alterar teto" quando ha teto e "Definir teto" quando nao ha', () => {
    create();
    expect(button('Alterar teto')).toBeDefined();

    tabs()[1].click();
    fixture.detectChanges();
    expect(button('Definir teto')).toBeDefined();
  });

  it('abrir o formulario pre-preenche com o teto atual ou o do ciclo anterior', () => {
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    expect(input()!.value).toBe('1000');

    button('Cancelar')!.click();
    fixture.detectChanges();
    tabs()[1].click();
    fixture.detectChanges();
    button('Definir teto')!.click();
    fixture.detectChanges();
    expect(input()!.value).toBe('500');
  });

  it('salvar envia PUT com o cardId da aba e recarrega o ciclo', () => {
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('750.5');
    submitForm();

    expect(api.setCreditCardCeiling).toHaveBeenCalledWith('c-principal', 750.5);
    expect(api.getCreditCardCycle).toHaveBeenCalledTimes(2);
    expect(input()).toBeNull();
  });

  it('valor zero: erro claro e nenhuma chamada', () => {
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('0');
    submitForm();

    expect(text()).toContain('Informe um teto maior que zero.');
    expect(api.setCreditCardCeiling).not.toHaveBeenCalled();
  });

  it('mais de duas casas decimais: erro e nenhuma chamada', () => {
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('1.234');
    submitForm();

    expect(text()).toContain('Use no máximo duas casas decimais.');
    expect(api.setCreditCardCeiling).not.toHaveBeenCalled();
  });

  it('enquanto salva: botao vira Salvando... e fica desligado', () => {
    const pending$ = new Subject<{ cardId: string; refreshPending: boolean }>();
    api.setCreditCardCeiling.and.returnValue(pending$.asObservable());
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('800');
    submitForm();

    const saving = button('Salvando...');
    expect(saving).toBeDefined();
    expect(saving!.disabled).toBeTrue();
    pending$.next({ cardId: 'c-principal', refreshPending: false });
    pending$.complete();
  });

  it('enquanto salva, um segundo envio nao faz outra chamada', () => {
    const pending$ = new Subject<{ cardId: string; refreshPending: boolean }>();
    api.setCreditCardCeiling.and.returnValue(pending$.asObservable());
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('800');
    submitForm();
    submitForm();

    expect(api.setCreditCardCeiling).toHaveBeenCalledTimes(1);
    pending$.complete();
  });

  it('400 mostra a mensagem do servidor; 404 e 409 mostram texto proprio', () => {
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('800');

    api.setCreditCardCeiling.and.returnValue(throwError(() => ({ status: 400, error: { message: 'Limite fora da faixa.' } })));
    submitForm();
    expect(text()).toContain('Limite fora da faixa.');

    api.setCreditCardCeiling.and.returnValue(throwError(() => ({ status: 404 })));
    submitForm();
    expect(text()).toContain('Cartão não encontrado. Atualize a tela.');

    api.setCreditCardCeiling.and.returnValue(throwError(() => ({ status: 409 })));
    submitForm();
    expect(text()).toContain('Cartão arquivado não recebe teto.');
  });

  it('erro 5xx: resultado desconhecido, texto de conferir e nenhuma nova tentativa', () => {
    api.setCreditCardCeiling.and.returnValue(throwError(() => ({ status: 500 })));
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('800');
    submitForm();

    expect(text()).toContain('Não sei se o teto foi salvo. Confira a tela antes de tentar de novo.');
    expect(button('Salvar teto')!.disabled).toBeTrue();
    submitForm();
    expect(api.setCreditCardCeiling).toHaveBeenCalledTimes(1);
  });

  it('rede caida (status 0): resultado desconhecido, texto de conferir e nenhuma nova tentativa', () => {
    api.setCreditCardCeiling.and.returnValue(throwError(() => ({ status: 0 })));
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('800');
    submitForm();

    expect(text()).toContain('Não sei se o teto foi salvo. Confira a tela antes de tentar de novo.');
    expect(button('Salvar teto')!.disabled).toBeTrue();
    submitForm();
    expect(api.setCreditCardCeiling).toHaveBeenCalledTimes(1);
  });

  it('Esc fecha o formulario sem gravar', () => {
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(input()).toBeNull();
    expect(api.setCreditCardCeiling).not.toHaveBeenCalled();
  });

  it('Esc durante o envio nao fecha o formulario', () => {
    const pending$ = new Subject<{ cardId: string; refreshPending: boolean }>();
    api.setCreditCardCeiling.and.returnValue(pending$.asObservable());
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    typeValue('800');
    submitForm();
    input()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(input()).not.toBeNull();
    pending$.complete();
  });

  it('cancelar fecha o formulario sem gravar', () => {
    create();
    button('Alterar teto')!.click();
    fixture.detectChanges();
    button('Cancelar')!.click();
    fixture.detectChanges();

    expect(input()).toBeNull();
    expect(api.setCreditCardCeiling).not.toHaveBeenCalled();
  });

  it('offline: sem botao de teto', () => {
    online.set(false);
    create();

    expect(button('Alterar teto')).toBeUndefined();
    expect(button('Definir teto')).toBeUndefined();
  });
});
