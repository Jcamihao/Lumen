import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, of } from 'rxjs';
import { BillingMe } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { ToastService } from '../../../core/services/toast.service';
import { PlanPageComponent } from './plan-page.component';

class FakeBillingService {
  readonly enabledSignal = signal(false);
  readonly meSignal = signal<BillingMe | null>(null);
  readonly enabled = this.enabledSignal.asReadonly();
  readonly me = this.meSignal.asReadonly();

  readonly loadMe = jasmine.createSpy('loadMe').and.callFake(() => {
    const value = this.meSignal();
    return value ? of(value) : of(null as unknown as BillingMe);
  });

  readonly checkout = jasmine
    .createSpy('checkout')
    .and.returnValue(of({ link: 'https://asaas.example/checkout/123' }));

  readonly cancel = jasmine.createSpy('cancel').and.returnValue(of(undefined));

  readonly sync = jasmine.createSpy('sync').and.returnValue(of(undefined));
}

const meFree = (): BillingMe => ({
  enabled: true,
  plan: 'FREE',
  status: null,
  source: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  latestInvoiceUrl: null,
  usage: {
    enforced: true,
    plan: 'FREE',
    resources: {
      goals: { used: 2, limit: 2 },
      envelopes: { used: 0, limit: 1 },
      recurringTransactions: { used: 0, limit: 3 },
      installmentPurchases: { used: 0, limit: 2 },
    },
    selahQuestions: { used: 3, limit: 5, resetsAt: '2026-10-01T03:00:00.000Z' },
  },
});

const meIndividualGrant = (): BillingMe => ({
  enabled: true,
  plan: 'INDIVIDUAL',
  status: 'ACTIVE',
  source: 'GRANT',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  latestInvoiceUrl: null,
  usage: {
    enforced: true,
    plan: 'INDIVIDUAL',
    resources: {
      goals: { used: 5, limit: null },
      envelopes: { used: 2, limit: null },
      recurringTransactions: { used: 1, limit: null },
      installmentPurchases: { used: 0, limit: null },
    },
    selahQuestions: { used: 10, limit: 300, resetsAt: '2026-10-01T03:00:00.000Z' },
  },
});

const meIndividualAsaas = (): BillingMe => ({
  ...meIndividualGrant(),
  source: 'ASAAS',
  currentPeriodEnd: '2026-10-27T00:00:00.000Z',
});

const mePastDue = (): BillingMe => ({
  ...meIndividualAsaas(),
  status: 'PAST_DUE',
  latestInvoiceUrl: 'https://asaas.example/fatura/999',
});

describe('PlanPageComponent', () => {
  let billing: FakeBillingService;
  let toast: jasmine.SpyObj<ToastService>;
  let fixture: ComponentFixture<PlanPageComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const clickButton = (label: string) => {
    const button = Array.from(root().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement;
    button?.click();
    fixture.detectChanges();
  };
  const findLink = (label: string) =>
    Array.from(root().querySelectorAll('a')).find((a) => a.textContent?.trim() === label) as
      | HTMLAnchorElement
      | undefined;

  beforeEach(() => {
    billing = new FakeBillingService();
    toast = jasmine.createSpyObj('ToastService', ['show', 'success', 'error']);
  });

  const create = (queryParams: Record<string, string> = {}) => {
    TestBed.configureTestingModule({
      imports: [PlanPageComponent],
      providers: [
        { provide: BillingService, useValue: billing },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams) } },
      ],
    });
    fixture = TestBed.createComponent(PlanPageComponent);
    fixture.detectChanges();
  };

  it('com a cobranca desligada, mostra o aviso e nenhuma barra de progresso', () => {
    billing.enabledSignal.set(false);

    create();

    expect(text()).toContain('A cobrança ainda não está ativa');
    expect(root().querySelectorAll('.proto-progress').length).toBe(0);
  });

  it('com plano Gratis, mostra o nome do plano e o uso de metas e Selah', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meFree());

    create();

    expect(text()).toContain('Grátis');
    expect(text()).toContain('2 de 2');
    expect(text()).toContain('3 de 5');
  });

  it('com plano Individual concedido, mostra o rotulo de concessao e "sem limite"', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meIndividualGrant());

    create();

    expect(text()).toContain('Plano Individual — concedido pelo Lumen');
    expect(text()).toContain('sem limite');
  });

  it('clicar "Assinar mensal" chama checkout e navega para o link do Asaas', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meFree());
    create();
    const navigateSpy = spyOn(fixture.componentInstance as any, 'navigateToExternal');

    clickButton('Assinar mensal');

    expect(billing.checkout).toHaveBeenCalledWith({ plan: 'INDIVIDUAL', interval: 'MONTHLY' });
    expect(navigateSpy).toHaveBeenCalledWith('https://asaas.example/checkout/123');
  });

  it('clicar "Cancelar" com confirmacao aceita chama cancel() e recarrega billing.me()', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meIndividualAsaas());
    create();
    spyOn(window, 'confirm').and.returnValue(true);
    const loadMeCallsBefore = billing.loadMe.calls.count();

    clickButton('Cancelar');

    expect(billing.cancel).toHaveBeenCalled();
    expect(billing.loadMe.calls.count()).toBe(loadMeCallsBefore + 1);
  });

  it('clicar "Cancelar" com confirmacao recusada nao chama cancel()', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meIndividualAsaas());
    create();
    spyOn(window, 'confirm').and.returnValue(false);

    clickButton('Cancelar');

    expect(billing.cancel).not.toHaveBeenCalled();
  });

  it('com status PAST_DUE e fatura disponivel, mostra "Regularizar pagamento" apontando pra fatura', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(mePastDue());

    create();

    const link = findLink('Regularizar pagamento');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('https://asaas.example/fatura/999');
  });

  it('com ?checkout=sucesso na URL, mostra "Confirmando pagamento..." e chama sync() uma vez', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meFree());
    // sync() nunca emite aqui de proposito: em produção é uma chamada HTTP assíncrona, então
    // a tela deve continuar mostrando "Confirmando pagamento..." até ela resolver.
    billing.sync.and.returnValue(new Subject<void>());

    create({ checkout: 'sucesso' });

    expect(text()).toContain('Confirmando pagamento');
    expect(billing.sync).toHaveBeenCalledTimes(1);
  });
});
