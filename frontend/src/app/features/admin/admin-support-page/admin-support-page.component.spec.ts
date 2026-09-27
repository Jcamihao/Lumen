import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FeedbackSummary, GrantView, SupportRequest } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AdminSupportPageComponent } from './admin-support-page.component';

const grant = (overrides: Partial<GrantView> = {}): GrantView => ({
  id: 'grant-1',
  email: 'ana@example.com',
  name: 'Ana',
  plan: 'INDIVIDUAL',
  status: 'ACTIVE',
  currentPeriodEnd: null,
  createdAt: '2026-09-27T00:00:00.000Z',
  ...overrides,
});

describe('AdminSupportPageComponent — Conceder plano', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let billing: jasmine.SpyObj<BillingService>;
  let fixture: ComponentFixture<AdminSupportPageComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const setVal = (sel: string, value: string) => {
    const el = root().querySelector<HTMLInputElement>(sel)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };
  const clickButton = (label: string) => {
    const button = Array.from(root().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement;
    button?.click();
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('LifeApiService', [
      'listAdminSupportRequests',
      'getFeedbackSummary',
      'updateSupportRequestStatus',
    ]);
    api.listAdminSupportRequests.and.returnValue(of([] as SupportRequest[]));
    api.getFeedbackSummary.and.returnValue(of(null as unknown as FeedbackSummary));

    billing = jasmine.createSpyObj('BillingService', ['listGrants', 'createGrant', 'revokeGrant']);
    billing.listGrants.and.returnValue(of([]));

    TestBed.configureTestingModule({
      imports: [AdminSupportPageComponent],
      providers: [
        { provide: LifeApiService, useValue: api },
        { provide: BillingService, useValue: billing },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    });
  });

  const create = () => {
    fixture = TestBed.createComponent(AdminSupportPageComponent);
    fixture.detectChanges();
  };

  it('ao iniciar, lista as concessões de plano', () => {
    billing.listGrants.and.returnValue(of([grant()]));

    create();

    expect(billing.listGrants).toHaveBeenCalled();
    expect(text()).toContain('ana@example.com');
  });

  it('conceder plano envia e-mail, plano INDIVIDUAL e a data escolhida, e adiciona a linha', () => {
    create();
    billing.createGrant.and.returnValue(of(grant({ id: 'grant-2', email: 'novo@example.com' })));

    setVal('#grant-email', 'novo@example.com');
    setVal('#grant-ends-at', '2026-12-31');
    clickButton('Conceder plano');

    expect(billing.createGrant).toHaveBeenCalledWith({
      email: 'novo@example.com',
      plan: 'INDIVIDUAL',
      endsAt: '2026-12-31',
    });

    fixture.detectChanges();
    expect(text()).toContain('novo@example.com');
  });

  it('conceder sem data opcional não envia endsAt', () => {
    create();
    billing.createGrant.and.returnValue(of(grant()));

    setVal('#grant-email', 'ana@example.com');
    clickButton('Conceder plano');

    expect(billing.createGrant).toHaveBeenCalledWith({
      email: 'ana@example.com',
      plan: 'INDIVIDUAL',
      endsAt: undefined,
    });
  });

  it('sem e-mail preenchido, não chama createGrant', () => {
    create();

    clickButton('Conceder plano');

    expect(billing.createGrant).not.toHaveBeenCalled();
  });

  it('revogar chama revokeGrant com o id da concessão', () => {
    billing.listGrants.and.returnValue(of([grant()]));
    create();
    billing.revokeGrant.and.returnValue(of(grant({ status: 'CANCELED' })));

    clickButton('Revogar');

    expect(billing.revokeGrant).toHaveBeenCalledWith('grant-1');
  });

  it('erro da API ao conceder mostra a mensagem do backend, não um texto genérico', () => {
    create();
    billing.createGrant.and.returnValue(
      throwError(() => ({ status: 404, error: { message: 'Usuário não encontrado.' } })),
    );
    const toast = TestBed.inject(ToastService);
    const errorSpy = spyOn(toast, 'error');

    setVal('#grant-email', 'ninguem@example.com');
    clickButton('Conceder plano');

    expect(errorSpy).toHaveBeenCalledWith('Usuário não encontrado.');
  });

  it('sem data de fim, mostra "sem fim"; com data, mostra o dia formatado', () => {
    billing.listGrants.and.returnValue(
      of([grant({ currentPeriodEnd: null }), grant({ id: 'grant-3', email: 'com-fim@example.com', currentPeriodEnd: '2026-12-31T00:00:00.000Z' })]),
    );

    create();

    expect(text()).toContain('sem fim');
    expect(text()).toContain('31/12/2026');
  });
});
