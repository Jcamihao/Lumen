import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { InstallmentPurchase } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { InstallmentPurchasesCardComponent } from './installment-purchases-card.component';

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const plan = (overrides: Partial<InstallmentPurchase> = {}): InstallmentPurchase => ({
  id: 'plan-1',
  description: 'iPhone',
  totalAmount: 1000,
  installmentAmount: 100,
  installmentsTotal: 10,
  installmentsGenerated: 3,
  categoryId: null,
  category: null,
  paymentMethod: null,
  anchorDay: 5,
  nextDueDate: '2027-01-05T00:00:00.000Z',
  isActive: true,
  paidAmount: 300,
  remainingAmount: 700,
  remainingInstallments: 7,
  ...overrides,
});

describe('InstallmentPurchasesCardComponent', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<InstallmentPurchasesCardComponent>;

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
      'listInstallmentPurchases',
      'createInstallmentPurchase',
      'deleteInstallmentPurchase',
    ]);
    api.listInstallmentPurchases.and.returnValue(of([]));

    TestBed.configureTestingModule({
      imports: [InstallmentPurchasesCardComponent],
      providers: [
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => ({ preferredCurrency: 'BRL', financeCategories: [] }) } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {}, errorWithAction: () => {} } },
      ],
    });
  });

  // O construtor ja chama load(): so cria o componente depois de configurar o mock do teste.
  const create = () => {
    fixture = TestBed.createComponent(InstallmentPurchasesCardComponent);
    fixture.detectChanges();
  };

  it('sem compras ainda, mostra o convite pra registrar a primeira', () => {
    create();

    expect(text()).toContain('Nenhuma compra parcelada ainda');
  });

  it('lista a compra com o progresso e quanto ainda falta', () => {
    api.listInstallmentPurchases.and.returnValue(of([plan()]));
    create();

    expect(text()).toContain('iPhone');
    expect(text()).toContain(`${money(1000)} total`);
    expect(text()).toContain(`3/10 pagas · restam ${money(700)}`);
  });

  it('a proxima parcela usa o dia certo, sem deslocar por fuso (UTC vs. Brasil)', () => {
    api.listInstallmentPurchases.and.returnValue(of([plan({ nextDueDate: '2026-10-22T00:00:00.000Z' })]));
    create();

    expect(text()).toContain('Próxima: 22 de out.');
    expect(text()).not.toContain('Próxima: 21 de out.');
  });

  it('quando ja pagou todas, mostra "Todas as parcelas pagas" em vez de fracao', () => {
    api.listInstallmentPurchases.and.returnValue(
      of([plan({ installmentsGenerated: 10, remainingInstallments: 0, remainingAmount: 0, nextDueDate: null })]),
    );
    create();

    expect(text()).toContain('Todas as parcelas pagas');
    expect(text()).toContain('Encerrada');
  });

  it('registrar uma compra envia descricao, valor total e numero de parcelas', () => {
    create();
    api.createInstallmentPurchase.and.returnValue(of(plan()));

    clickButton('Nova compra parcelada');
    fixture.detectChanges();
    setVal('#installment-description', 'Geladeira');
    setVal('#installment-total', '1200');
    setVal('#installment-count', '12');
    fixture.detectChanges();
    clickButton('Registrar compra');

    expect(api.createInstallmentPurchase).toHaveBeenCalledWith(
      jasmine.objectContaining({ description: 'Geladeira', totalAmount: 1200, installmentsTotal: 12 }),
    );
  });

  it('sem descricao, valor ou numero de parcelas valido, nao envia nada', () => {
    create();
    clickButton('Nova compra parcelada');
    fixture.detectChanges();

    clickButton('Registrar compra');

    expect(api.createInstallmentPurchase).not.toHaveBeenCalled();
  });

  it('menos de 2 parcelas e invalido (nao e parcelamento)', () => {
    create();
    clickButton('Nova compra parcelada');
    fixture.detectChanges();
    setVal('#installment-description', 'Fone');
    setVal('#installment-total', '100');
    setVal('#installment-count', '1');
    fixture.detectChanges();

    clickButton('Registrar compra');

    expect(api.createInstallmentPurchase).not.toHaveBeenCalled();
  });

  it('cancelar fecha o formulario sem criar nada', () => {
    create();
    clickButton('Nova compra parcelada');
    fixture.detectChanges();

    clickButton('Cancelar');
    fixture.detectChanges();

    expect(root().querySelector('#installment-description')).toBeNull();
    expect(api.createInstallmentPurchase).not.toHaveBeenCalled();
  });

  it('excluir pede confirmacao e chama a API quando confirmado', () => {
    api.listInstallmentPurchases.and.returnValue(of([plan()]));
    api.deleteInstallmentPurchase.and.returnValue(of({ success: true }));
    spyOn(window, 'confirm').and.returnValue(true);
    create();

    clickButton('Excluir');

    expect(api.deleteInstallmentPurchase).toHaveBeenCalledWith('plan-1');
  });

  it('excluir sem confirmar nao chama a API', () => {
    api.listInstallmentPurchases.and.returnValue(of([plan()]));
    spyOn(window, 'confirm').and.returnValue(false);
    create();

    clickButton('Excluir');

    expect(api.deleteInstallmentPurchase).not.toHaveBeenCalled();
  });

  it('erro ao carregar mostra "tentar de novo" e refaz a chamada', () => {
    api.listInstallmentPurchases.and.returnValue(throwError(() => new Error('falhou')));
    create();

    expect(text()).toContain('Não foi possível carregar as compras parceladas');

    api.listInstallmentPurchases.and.returnValue(of([plan()]));
    clickButton('Tentar de novo');
    fixture.detectChanges();

    expect(text()).toContain('iPhone');
  });

  it('erro do backend ao registrar mostra a mensagem, nao um texto generico', () => {
    create();
    api.createInstallmentPurchase.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Uma compra parcelada precisa de pelo menos 2 parcelas.' } })),
    );
    const toast = TestBed.inject(ToastService);
    const errorSpy = spyOn(toast, 'error');

    clickButton('Nova compra parcelada');
    fixture.detectChanges();
    setVal('#installment-description', 'Notebook');
    setVal('#installment-total', '3000');
    setVal('#installment-count', '2');
    fixture.detectChanges();
    clickButton('Registrar compra');

    expect(errorSpy).toHaveBeenCalledWith('Uma compra parcelada precisa de pelo menos 2 parcelas.');
  });

  it('erro de limite de plano (403 PLAN_LIMIT) chama errorWithAction com o link pra "Ver planos"', () => {
    create();
    api.createInstallmentPurchase.and.returnValue(
      throwError(() => ({
        status: 403,
        error: { code: 'PLAN_LIMIT', message: 'Você atingiu o limite de compras parceladas do plano Grátis.' },
      })),
    );
    const toast = TestBed.inject(ToastService);
    const errorSpy = spyOn(toast, 'error');
    const errorWithActionSpy = spyOn(toast, 'errorWithAction');

    clickButton('Nova compra parcelada');
    fixture.detectChanges();
    setVal('#installment-description', 'Notebook');
    setVal('#installment-total', '3000');
    setVal('#installment-count', '2');
    fixture.detectChanges();
    clickButton('Registrar compra');

    expect(errorWithActionSpy).toHaveBeenCalledWith(
      'Você atingiu o limite de compras parceladas do plano Grátis.',
      { label: 'Ver planos', route: '/plano' },
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
