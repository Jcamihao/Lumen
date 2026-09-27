import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { BillingService } from './billing.service';
import { BillingMe, GrantView, PublicPlan } from '../models/domain.models';

describe('BillingService', () => {
  let httpMock: HttpTestingController;
  let service: BillingService;

  const plan: PublicPlan = {
    id: 'FREE',
    label: 'Grátis',
    sellable: false,
    seats: 1,
    limits: { goals: 2, envelopes: 1, recurringTransactions: 3, installmentPurchases: 2 },
    selahQuestionsPerMonth: 5,
    prices: null,
  };

  const me: BillingMe = {
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
  };

  const grant: GrantView = {
    id: 'grant-1',
    email: 'ana@exemplo.com',
    name: 'Ana',
    plan: 'INDIVIDUAL',
    status: 'ACTIVE',
    currentPeriodEnd: null,
    createdAt: '2026-09-27T00:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(BillingService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('comeca com enabled=false e me=null', () => {
    expect(service.enabled()).toBe(false);
    expect(service.me()).toBeNull();
  });

  it('loadPlans faz GET em /billing/plans e atualiza enabled()', () => {
    service.loadPlans().subscribe();

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/billing/plans`);
    expect(req.request.method).toBe('GET');
    req.flush({ enabled: true, plans: [plan] });

    expect(service.enabled()).toBe(true);
  });

  it('loadMe faz GET em /billing/me e atualiza me()', () => {
    service.loadMe().subscribe();

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/billing/me`);
    expect(req.request.method).toBe('GET');
    req.flush(me);

    expect(service.me()).toEqual(me);
  });

  it('listGrants faz GET em /billing/admin/grants', () => {
    service.listGrants().subscribe((grants) => {
      expect(grants).toEqual([grant]);
    });

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/billing/admin/grants`);
    expect(req.request.method).toBe('GET');
    req.flush([grant]);
  });

  it('createGrant faz POST em /billing/admin/grants com o corpo enviado', () => {
    service.createGrant({ email: 'ana@exemplo.com', plan: 'INDIVIDUAL' }).subscribe((result) => {
      expect(result).toEqual(grant);
    });

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/billing/admin/grants`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'ana@exemplo.com', plan: 'INDIVIDUAL' });
    req.flush(grant);
  });

  it('revokeGrant faz DELETE em /billing/admin/grants/:id', () => {
    service.revokeGrant('grant-1').subscribe((result) => {
      expect(result).toEqual({ ...grant, status: 'CANCELED' });
    });

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/billing/admin/grants/grant-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ ...grant, status: 'CANCELED' });
  });
});
