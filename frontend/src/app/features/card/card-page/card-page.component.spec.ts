import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { CreditCard, CreditCardReceipt, CreditCycle, User } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { CardPageComponent, MAX_ACTIVE_CARDS } from './card-page.component';

const card = (overrides: Partial<CreditCard> = {}): CreditCard => ({
  id: 'c1',
  name: 'Nubank',
  closingDay: 5,
  dueDay: 15,
  countAllPayments: false,
  isDefault: true,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const receipt = (overrides: Partial<CreditCardReceipt> = {}): CreditCardReceipt => ({
  id: 'c1',
  name: 'Nubank',
  closingDay: 5,
  dueDay: 15,
  countAllPayments: false,
  isDefault: true,
  ...overrides,
});

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

const httpError = (status: number) => new HttpErrorResponse({ status });

describe('CardPageComponent', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let authService: { currentUser: () => Partial<User>; updateStoredUser: jasmine.Spy };
  let toast: { success: jasmine.Spy; error: jasmine.Spy };
  let offline: WritableSignal<boolean>;
  let fixture: ComponentFixture<CardPageComponent>;
  let cycle$: Subject<CreditCycle>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const field = (sel: string) => root().querySelector<HTMLInputElement>(sel)!;
  const setVal = (sel: string, value: string) => {
    const el = field(sel);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const submit = (sel: string) => {
    field(sel).closest('form')!.requestSubmit();
    fixture.detectChanges();
  };
  const buttons = (label: string) =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.textContent?.trim() === label,
    );
  const click = (label: string, index = 0) => {
    buttons(label)[index].click();
    fixture.detectChanges();
  };
  const clickIn = (cardName: string, label: string) => {
    const item = Array.from(root().querySelectorAll<HTMLLIElement>('li.card-page__item')).find((li) =>
      li.textContent?.includes(cardName),
    )!;
    Array.from(item.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === label)!
      .click();
    fixture.detectChanges();
  };
  const itemOf = (name: string) =>
    Array.from(root().querySelectorAll<HTMLLIElement>('li.card-page__item')).find((li) =>
      li.textContent?.includes(name),
    )!;

  const create = () => {
    fixture = TestBed.createComponent(CardPageComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    cycle$ = new Subject<CreditCycle>();
    offline = signal(false);
    api = jasmine.createSpyObj('LifeApiService', [
      'listCreditCards',
      'createCreditCard',
      'updateCreditCard',
      'archiveCreditCard',
      'makeDefaultCreditCard',
      'getCurrentCreditCycle',
      'setCreditCycleCeiling',
      'updateCreditCycleSettings',
    ]);
    (api as unknown as { offlineMode: WritableSignal<boolean> }).offlineMode = offline;
    api.listCreditCards.and.returnValue(of([card()]));
    api.getCurrentCreditCycle.and.returnValue(cycle$.asObservable());
    authService = {
      currentUser: () => ({ preferredCurrency: 'BRL', monthClosingDay: 5 }),
      updateStoredUser: jasmine.createSpy('updateStoredUser'),
    };
    toast = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };

    TestBed.configureTestingModule({
      imports: [CardPageComponent],
      providers: [
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: authService },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  describe('lista', () => {
    it('mostra "carregando" antes da resposta', () => {
      api.listCreditCards.and.returnValue(new Subject<CreditCard[]>().asObservable());
      create();

      expect(text()).toContain('Carregando cartões');
    });

    it('mostra nome, selo Padrão, fechamento e vencimento de cada cartao', () => {
      api.listCreditCards.and.returnValue(of([card(), card({ id: 'c2', name: 'Inter', isDefault: false, dueDay: null })]));
      create();

      expect(text()).toContain('Nubank');
      expect(text()).toContain('Padrão');
      expect(text()).toContain('Fecha dia 5 · vence dia 15');
      expect(text()).toContain('Inter');
      expect(text()).toContain('Fecha dia 5 · sem vencimento');
    });

    it('arquivados ficam escondidos por padrao e a lista pede so os ativos', () => {
      create();

      expect(api.listCreditCards).toHaveBeenCalledWith(false);
      expect(text()).not.toContain('Arquivado');
    });

    it('o interruptor "Mostrar arquivados" recarrega com o historico e mostra o arquivado sem acoes', () => {
      api.listCreditCards.and.returnValue(of([card(), card({ id: 'c2', name: 'Antigo', isDefault: false, archivedAt: '2026-02-01T00:00:00.000Z' })]));
      create();
      const toggle = root().querySelector<HTMLInputElement>('.card-page__toggle input')!;
      toggle.click();
      fixture.detectChanges();

      expect(api.listCreditCards).toHaveBeenCalledWith(true);
      const archived = itemOf('Antigo');
      expect(archived.textContent).toContain('Arquivado');
      expect(archived.querySelectorAll('button').length).toBe(0);
    });

    it('arquivado que o servidor devolve nao aparece com o interruptor desligado', () => {
      api.listCreditCards.and.returnValue(of([card(), card({ id: 'c9', name: 'Oculto', isDefault: false, archivedAt: '2026-02-01T00:00:00.000Z' })]));
      create();

      expect(text()).not.toContain('Oculto');
    });

    it('erro ao listar mostra "Tentar de novo" e o botao refaz a chamada', () => {
      api.listCreditCards.and.returnValue(throwError(() => httpError(0)));
      create();
      expect(text()).toContain('Não foi possível carregar seus cartões');

      api.listCreditCards.and.returnValue(of([card()]));
      click('Tentar de novo');

      expect(api.listCreditCards).toHaveBeenCalledTimes(2);
      expect(text()).toContain('Nubank');
    });
  });

  describe('criar', () => {
    beforeEach(() => {
      create();
      click('Novo cartão');
    });

    it('nome so com espacos nao envia e mostra erro', () => {
      setVal('#new-name', '   ');
      setVal('#new-closing', '10');
      submit('#new-name');

      expect(api.createCreditCard).not.toHaveBeenCalled();
      expect(text()).toContain('Dê um nome ao cartão.');
    });

    it('nome com mais de 40 caracteres mostra erro', () => {
      setVal('#new-name', 'a'.repeat(41));
      setVal('#new-closing', '10');
      submit('#new-name');

      expect(api.createCreditCard).not.toHaveBeenCalled();
      expect(text()).toContain('Use até 40 caracteres.');
    });

    it('envia nome aparado, fechamento e vencimento nulo quando vazio', () => {
      api.createCreditCard.and.returnValue(of(receipt({ id: 'c2', name: 'Inter', isDefault: false, closingDay: 10, dueDay: null })));
      setVal('#new-name', '  Inter  ');
      setVal('#new-closing', '10');
      submit('#new-name');

      expect(api.createCreditCard).toHaveBeenCalledWith({ name: 'Inter', closingDay: 10, dueDay: null });
      expect(toast.success).toHaveBeenCalledWith('Cartão criado.');
      expect(api.listCreditCards).toHaveBeenCalledTimes(2);
      expect(field('#new-name')).toBeNull();
    });

    it('envia o vencimento quando informado', () => {
      api.createCreditCard.and.returnValue(of(receipt({ id: 'c2', name: 'Inter', isDefault: false, dueDay: 20 })));
      setVal('#new-name', 'Inter');
      setVal('#new-closing', '10');
      setVal('#new-due', '20');
      submit('#new-name');

      expect(api.createCreditCard).toHaveBeenCalledWith({ name: 'Inter', closingDay: 10, dueDay: 20 });
    });

    it('fechamento fora de 1..31 ou vazio nao envia', () => {
      setVal('#new-name', 'Inter');
      for (const value of ['0', '32', '']) {
        setVal('#new-closing', value);
        submit('#new-name');
        expect(text()).toContain('Use um dia de 1 a 31.');
      }
      expect(api.createCreditCard).not.toHaveBeenCalled();
    });

    it('fechamento 1 e 31 sao aceitos', () => {
      api.createCreditCard.and.returnValue(of(receipt({ isDefault: false })));
      setVal('#new-name', 'A');
      setVal('#new-closing', '1');
      submit('#new-name');
      expect(api.createCreditCard).toHaveBeenCalledWith(jasmine.objectContaining({ closingDay: 1 }));

      create();
      click('Novo cartão');
      api.createCreditCard.calls.reset();
      api.createCreditCard.and.returnValue(of(receipt({ isDefault: false })));
      setVal('#new-name', 'B');
      setVal('#new-closing', '31');
      submit('#new-name');
      expect(api.createCreditCard).toHaveBeenCalledWith(jasmine.objectContaining({ closingDay: 31 }));
    });

    it('validadores do modelo: fechamento e vencimento fora de 1..31 sao invalidos', () => {
      const form = (fixture.componentInstance as unknown as {
        cardForm: { controls: { closingDay: AbstractControl; dueDay: AbstractControl } };
      }).cardForm;
      for (const value of [0, 32, null]) {
        form.controls.closingDay.setValue(value);
        expect(form.controls.closingDay.valid).toBeFalse();
      }
      for (const value of [0, 32]) {
        form.controls.dueDay.setValue(value);
        expect(form.controls.dueDay.valid).toBeFalse();
      }
      form.controls.closingDay.setValue(31);
      form.controls.dueDay.setValue(null);
      expect(form.controls.closingDay.valid).toBeTrue();
      expect(form.controls.dueDay.valid).toBeTrue();
    });

    it('vencimento 32 tambem e recusado', () => {
      setVal('#new-name', 'Inter');
      setVal('#new-closing', '10');
      setVal('#new-due', '32');
      submit('#new-name');

      expect(api.createCreditCard).not.toHaveBeenCalled();
      expect(text()).toContain('Use um dia de 1 a 31.');
    });

    it('vencimento fora de 1..31 mostra erro', () => {
      setVal('#new-name', 'Inter');
      setVal('#new-closing', '10');
      setVal('#new-due', '0');
      submit('#new-name');

      expect(api.createCreditCard).not.toHaveBeenCalled();
      expect(text()).toContain('Use um dia de 1 a 31.');
    });

    it('erro 409 (nome repetido) mostra texto em portugues e preserva o que foi digitado', () => {
      api.createCreditCard.and.returnValue(throwError(() => httpError(409)));
      setVal('#new-name', 'Nubank');
      setVal('#new-closing', '10');
      submit('#new-name');

      expect(text()).toContain('Já existe um cartão com este nome. Escolha outro.');
      expect(field('#new-name').value).toBe('Nubank');
      expect(field('#new-closing').value).toBe('10');
    });

    it('erro 400 mostra a orientacao de faixa', () => {
      api.createCreditCard.and.returnValue(throwError(() => httpError(400)));
      setVal('#new-name', 'Inter');
      setVal('#new-closing', '10');
      submit('#new-name');

      expect(text()).toContain('Confira os dados');
    });

    it('Esc fecha o formulario sem chamar a API', () => {
      field('#new-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(field('#new-name')).toBeNull();
      expect(api.createCreditCard).not.toHaveBeenCalled();
    });

    it('cancelar fecha o formulario sem chamar a API', () => {
      click('Cancelar');

      expect(field('#new-name')).toBeNull();
      expect(api.createCreditCard).not.toHaveBeenCalled();
    });
  });

  describe('editar', () => {
    it('abre o formulario do cartao preenchido e salva com PATCH (nome, fechamento, vencimento)', () => {
      api.updateCreditCard.and.returnValue(of(receipt({ closingDay: 7, dueDay: null })));
      create();
      click('Editar');

      expect(field('#edit-c1-name').value).toBe('Nubank');
      expect(field('#edit-c1-closing').value).toBe('5');
      expect(field('#edit-c1-due').value).toBe('15');

      setVal('#edit-c1-name', 'Nu');
      setVal('#edit-c1-closing', '7');
      setVal('#edit-c1-due', '');
      submit('#edit-c1-name');

      expect(api.updateCreditCard).toHaveBeenCalledWith('c1', { name: 'Nu', closingDay: 7, dueDay: null });
      expect(toast.success).toHaveBeenCalledWith('Cartão salvo.');
    });

    it('editar o cartao padrao atualiza o fechamento do usuario local e o ciclo', () => {
      api.updateCreditCard.and.returnValue(of(receipt({ closingDay: 7 })));
      create();
      cycle$.next(cycle());
      fixture.detectChanges();
      api.getCurrentCreditCycle.calls.reset();
      api.getCurrentCreditCycle.and.returnValue(of(cycle()));
      click('Editar');
      setVal('#edit-c1-closing', '7');
      submit('#edit-c1-name');

      expect(authService.updateStoredUser).toHaveBeenCalledWith(jasmine.objectContaining({ monthClosingDay: 7 }));
      expect(api.getCurrentCreditCycle).toHaveBeenCalledTimes(1);
    });

    it('editar cartao que nao e padrao nao altera o fechamento do usuario', () => {
      api.listCreditCards.and.returnValue(of([card({ id: 'c2', name: 'Inter', isDefault: false })]));
      api.updateCreditCard.and.returnValue(of(receipt({ id: 'c2', name: 'Inter', closingDay: 7, isDefault: false })));
      create();
      click('Editar');
      setVal('#edit-c2-closing', '7');
      submit('#edit-c2-name');

      expect(api.updateCreditCard).toHaveBeenCalled();
      expect(authService.updateStoredUser).not.toHaveBeenCalled();
    });

    it('erro 404 (cartao sumiu) avisa e recarrega a lista', () => {
      api.updateCreditCard.and.returnValue(throwError(() => httpError(404)));
      create();
      click('Editar');
      submit('#edit-c1-name');

      expect(text()).toContain('Este cartão não existe mais. A lista foi atualizada.');
      expect(api.listCreditCards).toHaveBeenCalledTimes(2);
    });

    it('valida o nome na edicao tambem', () => {
      create();
      click('Editar');
      setVal('#edit-c1-name', '');
      submit('#edit-c1-name');

      expect(api.updateCreditCard).not.toHaveBeenCalled();
      expect(text()).toContain('Dê um nome ao cartão.');
    });
  });

  describe('padrao', () => {
    it('o cartao padrao nao arquiva: botao desabilitado com o texto explicativo', () => {
      create();
      const archive = buttons('Arquivar')[0];

      expect(archive.disabled).toBeTrue();
      expect(text()).toContain('Torne outro cartão padrão antes de arquivar.');
    });

    it('nao mostra "Tornar padrão" no cartao que ja e padrao', () => {
      create();

      expect(buttons('Tornar padrão').length).toBe(0);
    });

    it('tornar padrao chama a API e atualiza o fechamento do usuario local', () => {
      api.listCreditCards.and.returnValue(of([card(), card({ id: 'c2', name: 'Inter', isDefault: false, closingDay: 20 })]));
      api.makeDefaultCreditCard.and.returnValue(of(receipt({ id: 'c2', name: 'Inter', closingDay: 20, isDefault: true })));
      create();
      click('Tornar padrão');

      expect(api.makeDefaultCreditCard).toHaveBeenCalledWith('c2');
      expect(authService.updateStoredUser).toHaveBeenCalledWith(jasmine.objectContaining({ monthClosingDay: 20 }));
      expect(toast.success).toHaveBeenCalledWith('Inter agora é o cartão padrão.');
    });
  });

  describe('arquivar (duas etapas)', () => {
    it('o cartao padrao nao entra em confirmacao mesmo chamado direto', () => {
      api.listCreditCards.and.returnValue(of([card()]));
      create();
      (fixture.componentInstance as unknown as { askArchive(c: CreditCard): void }).askArchive(card());
      fixture.detectChanges();

      const state = fixture.componentInstance as unknown as { confirmArchiveId(): string | null };
      expect(state.confirmArchiveId()).toBeNull();
    });

    beforeEach(() => {
      api.listCreditCards.and.returnValue(of([card(), card({ id: 'c2', name: 'Inter', isDefault: false })]));
      create();
    });

    it('o primeiro clique so pede confirmacao, sem chamar a API', () => {
      clickIn('Inter', 'Arquivar');

      expect(api.archiveCreditCard).not.toHaveBeenCalled();
      expect(buttons('Confirmar arquivamento').length).toBe(1);
    });

    it('cancelar a confirmacao nao arquiva', () => {
      clickIn('Inter', 'Arquivar');
      click('Cancelar');

      expect(api.archiveCreditCard).not.toHaveBeenCalled();
      expect(buttons('Confirmar arquivamento').length).toBe(0);
    });

    it('Esc cancela a confirmacao sem arquivar', () => {
      clickIn('Inter', 'Arquivar');
      buttons('Confirmar arquivamento')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(api.archiveCreditCard).not.toHaveBeenCalled();
      expect(buttons('Confirmar arquivamento').length).toBe(0);
    });

    it('o segundo clique arquiva o cartao', () => {
      api.archiveCreditCard.and.returnValue(of(receipt({ id: 'c2', name: 'Inter', isDefault: false })));
      clickIn('Inter', 'Arquivar');
      click('Confirmar arquivamento');

      expect(api.archiveCreditCard).toHaveBeenCalledWith('c2');
      expect(toast.success).toHaveBeenCalledWith('Inter arquivado.');
    });

    it('erro 404 ao arquivar mostra o texto e recarrega', () => {
      api.archiveCreditCard.and.returnValue(throwError(() => httpError(404)));
      clickIn('Inter', 'Arquivar');
      click('Confirmar arquivamento');

      expect(text()).toContain('Este cartão não existe mais');
      expect(api.listCreditCards).toHaveBeenCalledTimes(2);
    });
  });

  describe('teto de cartoes', () => {
    it('com o teto atingido, "Novo cartão" desabilita e explica', () => {
      const ten = Array.from({ length: MAX_ACTIVE_CARDS }, (_, i) =>
        card({ id: 'c' + i, name: 'Cartao ' + i, isDefault: i === 0 }),
      );
      api.listCreditCards.and.returnValue(of(ten));
      create();

      expect(buttons('Novo cartão')[0].disabled).toBeTrue();
      expect(text()).toContain('Você já tem 10 cartões ativos. Arquive um para criar outro.');
    });

    it('arquivados nao contam para o teto', () => {
      const nine = Array.from({ length: MAX_ACTIVE_CARDS - 1 }, (_, i) =>
        card({ id: 'c' + i, name: 'Cartao ' + i, isDefault: i === 0 }),
      );
      api.listCreditCards.and.returnValue(of([...nine, card({ id: 'x', name: 'Velho', isDefault: false, archivedAt: '2026-01-02T00:00:00.000Z' })]));
      create();

      expect(buttons('Novo cartão')[0].disabled).toBeFalse();
    });

    it('erro 422 do backend mostra o teto em portugues', () => {
      create();
      click('Novo cartão');
      api.createCreditCard.and.returnValue(throwError(() => httpError(422)));
      setVal('#new-name', 'Mais um');
      setVal('#new-closing', '3');
      submit('#new-name');

      expect(text()).toContain('Você já tem 10 cartões ativos');
    });
  });

  describe('offline', () => {
    it('startCreate offline nao abre o formulario', () => {
      offline.set(true);
      create();
      (fixture.componentInstance as unknown as { startCreate(): void }).startCreate();
      fixture.detectChanges();

      expect(field('#new-name')).toBeNull();
    });

    it('sem conexao: nao cria nem edita, mostra a mensagem e mantem a lista', () => {
      offline.set(true);
      create();

      expect(text()).toContain('Sem conexão: criar e editar cartões só funciona online.');
      expect(buttons('Novo cartão')[0].disabled).toBeTrue();
      expect(buttons('Editar')[0].disabled).toBeTrue();
      expect(text()).toContain('Nubank');
      expect(api.createCreditCard).not.toHaveBeenCalled();
      expect(api.updateCreditCard).not.toHaveBeenCalled();
    });
  });

  describe('ciclo do cartao padrao', () => {
    it('mostra o ciclo, quanto resta e o aviso de carregando antes da resposta', () => {
      create();
      expect(text()).toContain('Carregando o ciclo atual');

      cycle$.next(cycle({ ceiling: 1600, spent: 900, remaining: 700, percentUsed: 56, status: 'ok' }));
      fixture.detectChanges();

      expect(text()).toContain('06 de set. a 05 de out.');
      expect(text()).toContain(money(700));
    });

    it('erro no ciclo mostra "Tentar de novo" sem derrubar a lista', () => {
      create();
      cycle$.error(httpError(0));
      fixture.detectChanges();

      expect(text()).toContain('Não foi possível carregar o ciclo atual');
      expect(text()).toContain('Nubank');
    });

    it('salvar o teto chama setCreditCycleCeiling', () => {
      api.setCreditCycleCeiling.and.returnValue(of(cycle({ ceiling: 1600 })));
      create();
      cycle$.next(cycle());
      fixture.detectChanges();

      setVal('#card-ceiling', '1600');
      submit('#card-ceiling');

      expect(api.setCreditCycleCeiling).toHaveBeenCalledWith({ ceiling: 1600 });
    });

    it('o checkbox de escopo chama updateCreditCycleSettings com a inversao', () => {
      api.updateCreditCycleSettings.and.returnValue(of(cycle({ countAllPayments: true })));
      create();
      cycle$.next(cycle({ countAllPayments: false }));
      fixture.detectChanges();

      const checkbox = root().querySelector<HTMLInputElement>('.card-page__scope-toggle input')!;
      expect(checkbox.checked).toBeFalse();
      checkbox.click();
      fixture.detectChanges();

      expect(api.updateCreditCycleSettings).toHaveBeenCalledWith({ countAllPayments: true });
    });
  });
});
