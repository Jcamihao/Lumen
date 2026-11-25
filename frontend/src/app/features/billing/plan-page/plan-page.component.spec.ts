import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { BillingMe, GroupView, LimitedResource, UsageReport } from '../../../core/models/domain.models';
import { BillingService } from '../../../core/services/billing.service';
import { ToastService } from '../../../core/services/toast.service';
import { PlanPageComponent } from './plan-page.component';

class FakeBillingService {
  readonly enabledSignal = signal(false);
  readonly meSignal = signal<BillingMe | null>(null);
  readonly groupViewSignal = signal<GroupView | null>(null);
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

  readonly loadGroup = jasmine
    .createSpy('loadGroup')
    .and.callFake(() => of(this.groupViewSignal()));

  readonly createGroupInvite = jasmine
    .createSpy('createGroupInvite')
    .and.callFake((email: string) =>
      of({ id: 'i-1', email, createdAt: '2026-11-24T12:00:00.000Z', expiresAt: '2026-12-01T12:00:00.000Z', token: 'token-unico' }),
    );

  readonly revokeGroupInvite = jasmine.createSpy('revokeGroupInvite').and.returnValue(of(undefined));

  readonly acceptGroupInvite = jasmine
    .createSpy('acceptGroupInvite')
    .and.callFake(() => of(memberView));

  readonly leaveGroup = jasmine.createSpy('leaveGroup').and.returnValue(of(undefined));

  readonly removeGroupMember = jasmine.createSpy('removeGroupMember').and.returnValue(of(undefined));
}

const usageFor = (
  limits: Partial<Record<LimitedResource, number | null>>,
  used: Partial<Record<LimitedResource, number>>,
): UsageReport => ({
  enforced: true,
  plan: 'FREE',
  resources: {
    goals: { used: used['goals'] ?? 0, limit: limits['goals'] ?? null },
    envelopes: { used: used['envelopes'] ?? 0, limit: limits['envelopes'] ?? null },
    recurringTransactions: {
      used: used['recurringTransactions'] ?? 0,
      limit: limits['recurringTransactions'] ?? null,
    },
    installmentPurchases: {
      used: used['installmentPurchases'] ?? 0,
      limit: limits['installmentPurchases'] ?? null,
    },
    creditCards: { used: used['creditCards'] ?? 0, limit: limits['creditCards'] ?? null },
  },
  selahQuestions: { used: 3, limit: 5, resetsAt: '2026-10-01T03:00:00.000Z' },
});

const baseMe = (over: Partial<BillingMe>): BillingMe => ({
  enabled: true,
  plan: 'FREE',
  status: null,
  source: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  latestInvoiceUrl: null,
  group: null,
  usage: usageFor(
    { goals: 2, envelopes: 1, recurringTransactions: 3, installmentPurchases: 2, creditCards: 1 },
    { goals: 2, creditCards: 1 },
  ),
  ...over,
});

const meFree = () => baseMe({});

const meIndividualGrant = (): BillingMe =>
  baseMe({
    plan: 'INDIVIDUAL',
    status: 'ACTIVE',
    source: 'GRANT',
    usage: usageFor(
      { goals: null, envelopes: null, recurringTransactions: null, installmentPurchases: null, creditCards: 5 },
      { goals: 5, creditCards: 2 },
    ),
  });

const meIndividualAsaas = (): BillingMe => ({
  ...baseMe({
    plan: 'INDIVIDUAL',
    status: 'ACTIVE',
    source: 'ASAAS',
    currentPeriodEnd: '2026-10-27T00:00:00.000Z',
    usage: usageFor(
      { goals: null, envelopes: null, recurringTransactions: null, installmentPurchases: null, creditCards: 5 },
      { creditCards: 2 },
    ),
  }),
});

const mePastDue = (): BillingMe => ({
  ...meIndividualAsaas(),
  status: 'PAST_DUE',
  latestInvoiceUrl: 'https://asaas.example/fatura/999',
});

const ownerGroupView: GroupView = {
  role: 'owner',
  planActive: true,
  seats: 2,
  members: [
    { id: 'member-1', email: 'bruno@exemplo.com', name: 'Bruno', joinedAt: '2026-11-20T12:00:00.000Z' },
  ],
  invites: [
    {
      id: 'invite-1',
      email: 'dani@exemplo.com',
      createdAt: '2026-11-23T12:00:00.000Z',
      expiresAt: '2026-12-01T12:00:00.000Z',
    },
  ],
};

const memberView: GroupView = {
  role: 'member',
  ownerFirstName: 'Ana',
  joinedAt: '2026-11-20T12:00:00.000Z',
};

const meSharedOwner = (): BillingMe => ({
  ...meIndividualAsaas(),
  plan: 'SHARED',
  source: 'ASAAS',
  group: { role: 'owner', ownerFirstName: null },
});

const meSharedMember = (): BillingMe =>
  baseMe({
    plan: 'SHARED',
    group: { role: 'member', ownerFirstName: 'Ana' },
    usage: usageFor(
      { goals: null, envelopes: null, recurringTransactions: null, installmentPurchases: null, creditCards: 10 },
      { creditCards: 3 },
    ),
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
  const findButton = (label: string) =>
    Array.from(root().querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as
      | HTMLButtonElement
      | undefined;
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

  it('o uso lista a linha de cartoes com o limite do plano (D7)', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meFree());

    create();

    expect(text()).toContain('Cartões');
    expect(text()).toContain('1 de 1');
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

  it('botões "Assinar Compartilhado" chamam checkout com o plano SHARED (D8)', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meFree());
    create();
    spyOn(fixture.componentInstance as any, 'navigateToExternal');

    clickButton('Assinar Compartilhado mensal');
    expect(billing.checkout).toHaveBeenCalledWith({ plan: 'SHARED', interval: 'MONTHLY' });

    clickButton('Assinar Compartilhado anual');
    expect(billing.checkout).toHaveBeenCalledWith({ plan: 'SHARED', interval: 'YEARLY' });
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

  // --- Grupo do plano Compartilhado (contrato 11, 11a-2) ---

  it('pagador SHARED ve membros, convites pendentes e a conta de lugares', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meSharedOwner());
    billing.groupViewSignal.set(ownerGroupView);

    create();

    expect(text()).toContain('Membros');
    expect(text()).toContain('1 de 2 lugares usados');
    expect(text()).toContain('bruno@exemplo.com');
    expect(text()).toContain('dani@exemplo.com');
    expect(findButton('Convidar')).toBeTruthy();
  });

  it('pagador convida pelo e-mail e o link com o token aparece uma vez com botao copiar', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meSharedOwner());
    billing.groupViewSignal.set(ownerGroupView);
    create();

    const input = root().querySelector('.plan-group__invite input') as HTMLInputElement;
    input.value = 'dani@exemplo.com';
    root()
      .querySelector('form.plan-group__invite')!
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    fixture.detectChanges();

    expect(billing.createGroupInvite).toHaveBeenCalledWith('dani@exemplo.com');
    const linkInput = root().querySelector('.plan-group__link-input') as HTMLInputElement;
    expect(linkInput.value).toContain('?convite=token-unico');
    expect(findButton('Copiar link')).toBeTruthy();
  });

  it('pagador remove membro so com confirmacao (duas etapas)', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meSharedOwner());
    billing.groupViewSignal.set(ownerGroupView);
    create();
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);

    clickButton('Remover');
    expect(billing.removeGroupMember).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    clickButton('Remover');
    expect(billing.removeGroupMember).toHaveBeenCalledWith('member-1');
  });

  it('pagador revoga convite pendente', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meSharedOwner());
    billing.groupViewSignal.set(ownerGroupView);
    create();

    clickButton('Revogar');

    expect(billing.revokeGroupInvite).toHaveBeenCalledWith('invite-1');
  });

  it('membro ve o primeiro nome da pagadora e nenhum controle de convite', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meSharedMember());
    billing.groupViewSignal.set(memberView);

    create();

    expect(text()).toContain('Plano Compartilhado de Ana');
    expect(text()).toContain('Você usa o plano de Ana');
    expect(findButton('Convidar')).toBeUndefined();
    expect(findButton('Remover')).toBeUndefined();
  });

  it('membro sai do grupo so com confirmacao', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meSharedMember());
    billing.groupViewSignal.set(memberView);
    create();
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);

    clickButton('Sair do grupo');
    expect(billing.leaveGroup).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    clickButton('Sair do grupo');
    expect(billing.leaveGroup).toHaveBeenCalledTimes(1);
  });

  it('com ?convite= na URL, aceita o convite e avisa no toast de sucesso', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meFree());

    create({ convite: 'token-recebido' });

    expect(billing.acceptGroupInvite).toHaveBeenCalledWith('token-recebido');
    expect(toast.success).toHaveBeenCalledWith('Você entrou no grupo de Ana.');
  });

  it('convite invalido no aceite: toast com a mensagem uniforme do backend', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set(meFree());
    billing.acceptGroupInvite.and.returnValue(
      throwError(() => ({ status: 404, error: { message: 'Este convite de grupo é inválido ou expirou.' } })),
    );

    create({ convite: 'token-ruim' });

    expect(toast.error).toHaveBeenCalledWith('Este convite de grupo é inválido ou expirou.');
  });

  it('sem grupo (GET /billing/group 404), nenhum bloco de membros aparece', () => {
    billing.enabledSignal.set(true);
    billing.meSignal.set({ ...meSharedMember(), group: null });
    billing.groupViewSignal.set(null);

    create();

    expect(findButton('Convidar')).toBeUndefined();
    expect(text()).not.toContain('lugares usados');
  });
});
