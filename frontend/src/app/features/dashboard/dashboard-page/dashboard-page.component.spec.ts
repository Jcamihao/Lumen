import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { DashboardSummary, OnboardingProgress } from '../../../core/models/domain.models';
import { LifeApiService } from '../../../core/services/life-api.service';
import {
  DashboardPageComponent,
  SLOW_HINT_AFTER_MS,
  SUMMARY_TIMEOUT_MS,
} from './dashboard-page.component';

// O app registra o pt-BR no main.ts; o ambiente de teste nao passa por la.
registerLocaleData(localePt);

const summaryFixture = (): DashboardSummary => ({
  user: { id: 'u1', name: 'Marina Costa', preferredCurrency: 'BRL', monthlyIncome: 5000 },
  tasks: { todayCount: 0, overdueCount: 0, items: [] },
  finances: { balance: 100, monthlyExpenses: 0, monthlyIncome: 0, recentTransactions: [] },
  goals: [],
  reminders: [],
  insights: [],
  forecast: { id: 'f1', predictedBalance: 100, riskLevel: 'LOW' },
  notifications: [],
});

describe('DashboardPageComponent — carregamento', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let summary$: Subject<DashboardSummary>;
  let fixture: ComponentFixture<DashboardPageComponent>;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const query = (selector: string) => (fixture.nativeElement as HTMLElement).querySelector(selector);

  const create = () => {
    fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    summary$ = new Subject<DashboardSummary>();
    api = jasmine.createSpyObj('LifeApiService', [
      'getDashboardSummary',
      'listTransactions',
      'getForecastAccuracy',
    ]);
    api.getDashboardSummary.and.callFake(() => summary$.asObservable());
    api.listTransactions.and.returnValue(of([]));
    api.getForecastAccuracy.and.returnValue(of(null as never));

    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [
        provideRouter([]),
        { provide: LOCALE_ID, useValue: 'pt-BR' },
        { provide: LifeApiService, useValue: api },
      ],
    });
  });

  it('mostra o esqueleto (com aviso para leitor de tela) enquanto carrega', fakeAsync(() => {
    create();

    const status = query('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(text()).toContain('Carregando início');
    expect(query('.skeleton')).not.toBeNull();

    fixture.destroy();
  }));

  it('nao avisa de demora antes de 5 s, e avisa depois', fakeAsync(() => {
    create();

    tick(SLOW_HINT_AFTER_MS - 1);
    fixture.detectChanges();
    expect(text()).not.toContain('demorando mais que o normal');

    tick(1);
    fixture.detectChanges();
    expect(text()).toContain('demorando mais que o normal');

    fixture.destroy();
  }));

  it('mostra a home quando os dados chegam, sem esqueleto nem erro', fakeAsync(() => {
    create();

    summary$.next(summaryFixture());
    fixture.detectChanges();

    expect(text()).toContain('Bom te ver, Marina.');
    expect(query('.skeleton')).toBeNull();
    expect(query('[role="alert"]')).toBeNull();

    fixture.destroy();
  }));

  it('vira erro com "Tentar de novo" quando o servidor devolve erro (antes ficava carregando para sempre)', fakeAsync(() => {
    create();

    summary$.error({ status: 504 });
    fixture.detectChanges();

    expect(query('[role="alert"]')).not.toBeNull();
    expect(text()).toContain('Não foi possível carregar o início');
    expect(text()).toContain('Tentar de novo');
    expect(query('.skeleton')).toBeNull();

    fixture.destroy();
  }));

  it('vira erro depois de 15 s sem resposta e para de mostrar o aviso de demora', fakeAsync(() => {
    create();

    tick(SUMMARY_TIMEOUT_MS - 1);
    fixture.detectChanges();
    expect(query('[role="alert"]')).toBeNull();

    tick(1);
    fixture.detectChanges();
    expect(query('[role="alert"]')).not.toBeNull();
    expect(text()).not.toContain('demorando mais que o normal');

    fixture.destroy();
  }));

  it('"Tentar de novo" volta ao esqueleto, pede de novo e mostra a home se der certo', fakeAsync(() => {
    create();
    summary$.error({ status: 500 });
    fixture.detectChanges();
    expect(api.getDashboardSummary).toHaveBeenCalledTimes(1);

    // Segunda tentativa usa um Subject novo (o anterior ja errou).
    summary$ = new Subject<DashboardSummary>();
    (query('[role="alert"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api.getDashboardSummary).toHaveBeenCalledTimes(2);
    expect(query('[role="alert"]')).toBeNull();
    expect(query('.skeleton')).not.toBeNull();

    summary$.next(summaryFixture());
    fixture.detectChanges();
    expect(text()).toContain('Bom te ver, Marina.');

    fixture.destroy();
  }));

  it('a segunda tentativa tambem pode falhar e volta para o erro', fakeAsync(() => {
    create();
    summary$.error({ status: 500 });
    fixture.detectChanges();

    summary$ = new Subject<DashboardSummary>();
    (query('[role="alert"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    summary$.error({ status: 504 });
    fixture.detectChanges();

    expect(query('[role="alert"]')).not.toBeNull();

    fixture.destroy();
  }));
});

describe('DashboardPageComponent — onboarding', () => {
  let fixture: ComponentFixture<DashboardPageComponent>;

  const none: OnboardingProgress = { tasks: false, transactions: false, goals: false, recurring: false, selah: false };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const query = (selector: string) => (fixture.nativeElement as HTMLElement).querySelector(selector);

  const open = (onboarding?: OnboardingProgress) => {
    const api = jasmine.createSpyObj('LifeApiService', [
      'getDashboardSummary',
      'listTransactions',
      'getForecastAccuracy',
    ]);
    api.getDashboardSummary.and.returnValue(of({ ...summaryFixture(), onboarding }));
    api.listTransactions.and.returnValue(of([]));
    api.getForecastAccuracy.and.returnValue(of(null as never));

    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [
        provideRouter([]),
        { provide: LOCALE_ID, useValue: 'pt-BR' },
        { provide: LifeApiService, useValue: api },
      ],
    });

    fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
  };

  beforeEach(() => localStorage.removeItem('lumen.onboarding.dismissed.u1'));
  afterEach(() => localStorage.removeItem('lumen.onboarding.dismissed.u1'));

  it('conta nova: destaque honesto, sem pontuacao inventada e com os primeiros passos', () => {
    open(none);

    expect(text()).toContain('Vamos começar pelo básico');
    expect(text()).toContain('Criar primeira tarefa');
    expect(text()).toContain('aparece depois das primeiras tarefas e gastos');
    expect(query('.home-score')).toBeNull();
    expect(text()).not.toContain('Seu dia esta sob controle');
    expect(text()).toContain('0 de 5 concluídos');
    expect(query('.home-onboarding')).not.toBeNull();
  });

  it('conta nova nao pode dispensar os primeiros passos (e o unico conteudo)', () => {
    open(none);

    expect(text()).not.toContain('Dispensar');
  });

  it('com atividade: volta a mostrar a pontuacao e o progresso parcial, com botao de dispensar', () => {
    open({ ...none, tasks: true, goals: true });

    expect(query('.home-score')).not.toBeNull();
    expect(text()).not.toContain('Vamos começar pelo básico');
    expect(text()).toContain('2 de 5 concluídos');
    expect(text()).toContain('Dispensar');
    expect(query('.home-onboarding__step.is-done')).not.toBeNull();
  });

  it('dispensar esconde o cartao e lembra a escolha para este usuario', () => {
    open({ ...none, tasks: true });

    const dismiss = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Dispensar'),
    ) as HTMLButtonElement;
    dismiss.click();
    fixture.detectChanges();

    expect(query('.home-onboarding')).toBeNull();
    expect(localStorage.getItem('lumen.onboarding.dismissed.u1')).toBe('1');

    // Nova abertura da home: continua dispensado.
    TestBed.resetTestingModule();
    open({ ...none, tasks: true });
    expect(query('.home-onboarding')).toBeNull();
  });

  it('tudo concluido: o cartao some sozinho', () => {
    open({ tasks: true, transactions: true, goals: true, recurring: true, selah: true });

    expect(query('.home-onboarding')).toBeNull();
    expect(query('.home-score')).not.toBeNull();
  });

  it('sem informacao de onboarding (offline / resumo antigo): comportamento de sempre', () => {
    open(undefined);

    expect(query('.home-onboarding')).toBeNull();
    expect(query('.home-score')).not.toBeNull();
    expect(text()).not.toContain('Vamos começar pelo básico');
  });

  it('oferece criar o primeiro item nas faixas vazias enquanto o passo nao foi feito', () => {
    open(none);

    expect(text()).toContain('Criar primeira meta');
    expect(text()).toContain('Registrar movimentação');
  });
});
