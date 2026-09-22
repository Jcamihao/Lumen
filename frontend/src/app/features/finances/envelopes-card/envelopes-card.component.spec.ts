import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Envelope } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { EnvelopesCardComponent } from './envelopes-card.component';

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const envelope = (overrides: Partial<Envelope> = {}): Envelope => ({
  id: 'env-1',
  name: 'Gasolina',
  color: '#f18f01',
  icon: null,
  monthlyAmount: 700,
  isActive: true,
  deposited: 700,
  spent: 280,
  available: 420,
  ...overrides,
});

describe('EnvelopesCardComponent', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<EnvelopesCardComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';
  const rowClick = (name: string, label: string) => {
    for (const row of Array.from(root().querySelectorAll('.envelope-row'))) {
      if (row.querySelector('.envelope-row__name')?.textContent?.includes(name)) {
        const button = Array.from(row.querySelectorAll('button')).find((b) =>
          b.textContent?.trim().includes(label),
        ) as HTMLButtonElement;
        button?.click();
        return !!button;
      }
    }
    return false;
  };
  const setVal = (sel: string, value: string) => {
    const el = root().querySelector<HTMLInputElement>(sel)!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };
  const clickCardButton = (label: string) => {
    const button = Array.from(root().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement;
    button?.click();
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('LifeApiService', [
      'listEnvelopes',
      'createEnvelope',
      'updateEnvelope',
      'deleteEnvelope',
    ]);
    api.listEnvelopes.and.returnValue(of([]));

    TestBed.configureTestingModule({
      imports: [EnvelopesCardComponent],
      providers: [
        { provide: LifeApiService, useValue: api },
        { provide: AuthService, useValue: { currentUser: () => ({ preferredCurrency: 'BRL' }) } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
      ],
    });

  });

  // O construtor ja chama load(): so cria o componente depois de configurar o mock do teste.
  const create = () => {
    fixture = TestBed.createComponent(EnvelopesCardComponent);
    fixture.detectChanges();
  };

  it('sem envelopes ainda, mostra o convite pra criar o primeiro', () => {
    create();

    expect(text()).toContain('Nenhum envelope ainda');
  });

  it('lista o envelope com quanto ja foi gasto, guardado e disponivel', () => {
    api.listEnvelopes.and.returnValue(of([envelope()]));
    create();

    expect(text()).toContain('Gasolina');
    expect(root().querySelector('.envelope-row__head strong')?.textContent).toContain(money(420));
    expect(text()).toContain(`${money(280)} gastos de ${money(700)} guardados`);
  });

  it('saldo negativo (gastou mais do que guardou) fica destacado', () => {
    api.listEnvelopes.and.returnValue(of([envelope({ available: -50, spent: 750 })]));
    create();

    const amount = root().querySelector('.envelope-row__head strong');
    expect(amount?.classList).toContain('envelope-row__negative');
    expect(amount?.textContent).toContain(money(-50));
  });

  it('a barra nunca passa de 100%, mesmo gastando mais do que o guardado', () => {
    api.listEnvelopes.and.returnValue(of([envelope({ deposited: 700, spent: 1200 })]));
    create();

    const bar = root().querySelector<HTMLElement>('.envelope-row__bar > span');
    expect(bar?.style.width).toBe('100%');
  });

  it('envelope pausado aparece com a etiqueta e opacidade reduzida', () => {
    api.listEnvelopes.and.returnValue(of([envelope({ isActive: false })]));
    create();

    expect(text()).toContain('Pausado');
    expect(root().querySelector('.envelope-row')?.classList).toContain('envelope-row--paused');
  });

  it('criar um envelope novo envia nome e valor, com uma cor da paleta', () => {
    create();
    api.createEnvelope.and.returnValue(of(envelope()));

    clickCardButton('Novo envelope');
    fixture.detectChanges();
    setVal('#envelope-name', 'Mercado');
    setVal('#envelope-amount', '500');
    fixture.detectChanges();
    clickCardButton('Criar envelope');

    expect(api.createEnvelope).toHaveBeenCalledWith(
      jasmine.objectContaining({ name: 'Mercado', monthlyAmount: 500 }),
    );
  });

  it('criar sem nome ou valor nao envia nada', () => {
    create();
    clickCardButton('Novo envelope');
    fixture.detectChanges();

    clickCardButton('Criar envelope');

    expect(api.createEnvelope).not.toHaveBeenCalled();
  });

  it('cancelar fecha o formulario sem criar nada', () => {
    create();
    clickCardButton('Novo envelope');
    fixture.detectChanges();

    clickCardButton('Cancelar');
    fixture.detectChanges();

    expect(root().querySelector('#envelope-name')).toBeNull();
    expect(api.createEnvelope).not.toHaveBeenCalled();
  });

  it('pausar e retomar chamam updateEnvelope com isActive invertido, e emitem "changed"', () => {
    api.listEnvelopes.and.returnValue(of([envelope({ isActive: true })]));
    api.updateEnvelope.and.returnValue(of(envelope({ isActive: false })));
    create();
    const changedSpy = jasmine.createSpy('changed');
    fixture.componentInstance.changed.subscribe(changedSpy);

    rowClick('Gasolina', 'Pausar');

    expect(api.updateEnvelope).toHaveBeenCalledWith('env-1', { isActive: false });
    expect(changedSpy).toHaveBeenCalled();
  });

  it('excluir pede confirmacao e chama a API quando confirmado', () => {
    api.listEnvelopes.and.returnValue(of([envelope()]));
    api.deleteEnvelope.and.returnValue(of({ success: true }));
    spyOn(window, 'confirm').and.returnValue(true);
    create();

    rowClick('Gasolina', 'Excluir');

    expect(api.deleteEnvelope).toHaveBeenCalledWith('env-1');
  });

  it('excluir sem confirmar nao chama a API', () => {
    api.listEnvelopes.and.returnValue(of([envelope()]));
    spyOn(window, 'confirm').and.returnValue(false);
    create();

    rowClick('Gasolina', 'Excluir');

    expect(api.deleteEnvelope).not.toHaveBeenCalled();
  });

  it('erro ao carregar mostra "tentar de novo" e refaz a chamada', () => {
    api.listEnvelopes.and.returnValue(throwError(() => new Error('falhou')));
    create();

    expect(text()).toContain('Não foi possível carregar os envelopes');

    api.listEnvelopes.and.returnValue(of([envelope()]));
    clickCardButton('Tentar de novo');
    fixture.detectChanges();

    expect(text()).toContain('Gasolina');
  });

  it('erro de nome duplicado mostra a mensagem do backend, nao um texto generico', () => {
    create();
    api.createEnvelope.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Você já tem um envelope com este nome.' } })),
    );
    const toast = TestBed.inject(ToastService);
    const errorSpy = spyOn(toast, 'error');

    clickCardButton('Novo envelope');
    fixture.detectChanges();
    setVal('#envelope-name', 'Gasolina');
    setVal('#envelope-amount', '100');
    fixture.detectChanges();
    clickCardButton('Criar envelope');

    expect(errorSpy).toHaveBeenCalledWith('Você já tem um envelope com este nome.');
  });

  it('erro sem mensagem do backend (ex.: rede) cai no texto padrão', () => {
    create();
    api.createEnvelope.and.returnValue(throwError(() => ({ status: 0 })));
    const toast = TestBed.inject(ToastService);
    const errorSpy = spyOn(toast, 'error');

    clickCardButton('Novo envelope');
    fixture.detectChanges();
    setVal('#envelope-name', 'Gasolina');
    setVal('#envelope-amount', '100');
    fixture.detectChanges();
    clickCardButton('Criar envelope');

    expect(errorSpy).toHaveBeenCalledWith('Não foi possível criar o envelope agora.');
  });
});
