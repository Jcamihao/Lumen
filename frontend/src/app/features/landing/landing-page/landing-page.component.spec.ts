import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { PublicPlan } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { LandingPageComponent } from './landing-page.component';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

class FakeBillingService {
  readonly enabledSignal = signal(false);
  readonly enabled = this.enabledSignal.asReadonly();

  private plansResponse: { enabled: boolean; plans: PublicPlan[] } = { enabled: false, plans: [] };

  setPlansResponse(response: { enabled: boolean; plans: PublicPlan[] }) {
    this.plansResponse = response;
  }

  readonly loadPlans = jasmine.createSpy('loadPlans').and.callFake(() => {
    this.enabledSignal.set(this.plansResponse.enabled);
    return of(this.plansResponse);
  });
}

const individualPlan = (): PublicPlan => ({
  id: 'INDIVIDUAL',
  label: 'Individual',
  sellable: true,
  seats: 1,
  limits: {
    goals: null,
    envelopes: null,
    recurringTransactions: null,
    installmentPurchases: null,
    creditCards: 5,
  },
  selahQuestionsPerMonth: 300,
  prices: { MONTHLY: 29.9, YEARLY: 299 },
});

const sharedPlan = (): PublicPlan => ({
  id: 'SHARED',
  label: 'Compartilhado',
  sellable: false,
  seats: 2,
  limits: {
    goals: null,
    envelopes: null,
    recurringTransactions: null,
    installmentPurchases: null,
    creditCards: 10,
  },
  selahQuestionsPerMonth: 300,
  prices: { MONTHLY: 49.9, YEARLY: 499 },
});

const freePlan = (): PublicPlan => ({
  id: 'FREE',
  label: 'Grátis',
  sellable: true,
  seats: 1,
  limits: {
    goals: 2,
    envelopes: 1,
    recurringTransactions: 3,
    installmentPurchases: 2,
    creditCards: 1,
  },
  selahQuestionsPerMonth: 5,
  prices: null,
});

describe('LandingPageComponent', () => {
  let billing: FakeBillingService;
  let fixture: ComponentFixture<LandingPageComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const findLinks = (label: string) =>
    Array.from(root().querySelectorAll('a')).filter((a) => a.textContent?.trim() === label);

  beforeEach(() => {
    billing = new FakeBillingService();
  });

  const create = () => {
    TestBed.configureTestingModule({
      imports: [LandingPageComponent],
      providers: [
        { provide: BillingService, useValue: billing },
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      ],
    });
    fixture = TestBed.createComponent(LandingPageComponent);
    fixture.detectChanges();
  };

  it('com a cobranca desligada, nao mostra o link "Preços" nem a secao de precos, e o FAQ mostra o texto estatico', () => {
    billing.setPlansResponse({ enabled: false, plans: [] });

    create();

    expect(findLinks('Preços').length).toBe(0);
    expect(root().querySelector('#precos')).toBeNull();
    expect(text()).toContain('Hoje o Lumen é gratuito. Não existe plano pago nem cobrança — é uma conta só, sem letra miúda.');
  });

  it('com a cobranca ligada, mostra o link "Preços" (desktop e mobile) e a secao de precos com os valores do plano Individual', () => {
    billing.setPlansResponse({ enabled: true, plans: [freePlan(), individualPlan(), sharedPlan()] });

    create();

    // Nav desktop + menu mobile (renderizado quando mobileMenuOpen() é true)
    (fixture.componentInstance as any).mobileMenuOpen.set(true);
    fixture.detectChanges();
    expect(findLinks('Preços').length).toBe(2);

    const section = root().querySelector('#precos');
    expect(section).toBeTruthy();

    const sectionText = section?.textContent ?? '';
    expect(sectionText).toContain(currency.format(29.9));
    expect(sectionText).toContain(currency.format(299));
    expect(sectionText).toContain('300 perguntas/mês');
  });

  it('com a cobranca ligada, nunca renderiza o plano SHARED (sellable: false)', () => {
    billing.setPlansResponse({ enabled: true, plans: [freePlan(), individualPlan(), sharedPlan()] });

    create();

    expect(text()).not.toContain('Compartilhado');
  });

  it('checa sellable de verdade, nao so o id: um plano INDIVIDUAL com sellable:false tambem nao renderiza o card', () => {
    billing.setPlansResponse({
      enabled: true,
      plans: [freePlan(), { ...individualPlan(), sellable: false }],
    });

    create();

    expect(root().querySelector('#precos')).toBeTruthy();
    expect(text()).not.toContain('300 perguntas/mês');
  });

  it('com a cobranca ligada e plano Individual carregado, o FAQ mostra a resposta dinamica com o preco', () => {
    billing.setPlansResponse({ enabled: true, plans: [freePlan(), individualPlan(), sharedPlan()] });

    create();

    expect(text()).not.toContain('Hoje o Lumen é gratuito. Não existe plano pago nem cobrança — é uma conta só, sem letra miúda.');
    expect(text()).toContain(currency.format(29.9));
    expect(text()).toContain('Veja os detalhes na seção Preços');
  });
});
