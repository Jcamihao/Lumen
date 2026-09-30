import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  it('success() cria um toast sem action', () => {
    service.success('Tudo certo.');

    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].tone).toBe('success');
    expect(service.toasts()[0].message).toBe('Tudo certo.');
    expect(service.toasts()[0].action).toBeUndefined();
  });

  it('error() cria um toast de erro sem action', () => {
    service.error('Deu ruim.');

    expect(service.toasts()[0].tone).toBe('error');
    expect(service.toasts()[0].action).toBeUndefined();
  });

  it('errorWithAction() cria um toast de erro com a action anexada', () => {
    service.errorWithAction('Limite do plano atingido.', { label: 'Ver planos', route: '/plano' });

    expect(service.toasts().length).toBe(1);
    const toast = service.toasts()[0];
    expect(toast.tone).toBe('error');
    expect(toast.message).toBe('Limite do plano atingido.');
    expect(toast.action).toEqual({ label: 'Ver planos', route: '/plano' });
  });

  it('show() aceita uma action opcional diretamente', () => {
    service.show('Mensagem qualquer.', 'info', 1000, { label: 'Ir', route: '/x' });

    expect(service.toasts()[0].action).toEqual({ label: 'Ir', route: '/x' });
  });

  it('dismiss() remove o toast pelo id', () => {
    service.success('Vai sumir.');
    const id = service.toasts()[0].id;

    service.dismiss(id);

    expect(service.toasts().length).toBe(0);
  });
});
