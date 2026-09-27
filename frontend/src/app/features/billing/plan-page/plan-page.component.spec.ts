import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { BillingMe } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { PlanPageComponent } from './plan-page.component';

class FakeBillingService {
  readonly enabledSignal = signal(false);
  readonly meSignal = signal<BillingMe | null>(null);
  readonly enabled = this.enabledSignal.asReadonly();
  readonly me = this.meSignal.asReadonly();

  loadMe() {
    const value = this.meSignal();
    return value ? of(value) : of(null as unknown as BillingMe);
  }
}

const meFree = (): BillingMe => ({
  enabled: true,
  plan: 'FREE',
  status: null,
  source: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
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

describe('PlanPageComponent', () => {
  let billing: FakeBillingService;
  let fixture: ComponentFixture<PlanPageComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';

  beforeEach(() => {
    billing = new FakeBillingService();

    TestBed.configureTestingModule({
      imports: [PlanPageComponent],
      providers: [{ provide: BillingService, useValue: billing }],
    });
  });

  const create = () => {
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
});
