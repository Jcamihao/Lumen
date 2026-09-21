import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { APP_VERSION } from '../../../core/app-version';
import { SupportRequest } from '../../../core/models/domain.models';
import { LifeApiService } from '../../../core/services/life-api.service';
import { FeedbackPageComponent } from './feedback-page.component';

const created = (id = 'sr-1'): SupportRequest => ({
  id,
  type: 'FEEDBACK',
  status: 'OPEN',
  severity: null,
  subject: 'x',
  message: 'y',
  emailSnapshot: 'ana@example.com',
  screenPath: null,
  appVersion: null,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
  user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
});

describe('FeedbackPageComponent', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<FeedbackPageComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => root().textContent ?? '';

  const clickRating = (value: number) => {
    const buttons = Array.from(root().querySelectorAll<HTMLButtonElement>('.feedback-rating__option'));
    buttons[value - 1].click();
    fixture.detectChanges();
  };

  const clickArea = (label: string) => {
    const button = Array.from(root().querySelectorAll<HTMLButtonElement>('.feedback-area')).find((item) =>
      item.textContent?.includes(label),
    );
    button?.click();
    fixture.detectChanges();
  };

  const write = (id: string, value: string) => {
    const field = root().querySelector<HTMLTextAreaElement>(`#${id}`)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const submit = () => {
    root().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('LifeApiService', ['createSupportRequest']);
    api.createSupportRequest.and.returnValue(of(created()));

    TestBed.configureTestingModule({
      imports: [FeedbackPageComponent],
      providers: [provideRouter([]), { provide: LifeApiService, useValue: api }],
    });

    fixture = TestBed.createComponent(FeedbackPageComponent);
    fixture.detectChanges();
  });

  it('abre com a area "Geral" marcada quando nao sabe de onde o usuario veio', () => {
    const selected = root().querySelector('.feedback-area.is-selected');

    expect(selected?.textContent).toContain('Geral');
  });

  it('nao envia sem nota e explica o que falta', () => {
    write('feedback-liked', 'Gostei bastante da rosca de gastos.');
    submit();

    expect(api.createSupportRequest).not.toHaveBeenCalled();
    expect(text()).toContain('Escolha uma nota de 1 a 5');
  });

  it('nao envia sem texto suficiente', () => {
    clickRating(4);
    write('feedback-liked', 'ok');
    submit();

    expect(api.createSupportRequest).not.toHaveBeenCalled();
    expect(text()).toContain('Escreva pelo menos uma frase');
  });

  it('aceita so um dos dois campos de texto', () => {
    clickRating(5);
    write('feedback-improve', 'Faltou criar categoria nova.');
    submit();

    expect(api.createSupportRequest).toHaveBeenCalledTimes(1);
  });

  it('envia nota, area, texto por secao, contato e contexto do aparelho', () => {
    clickRating(4);
    clickArea('Finanças');
    write('feedback-liked', 'Gostei da rosca de gastos.');
    write('feedback-improve', 'Faltou criar categoria nova.');
    (root().querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    submit();

    const payload = api.createSupportRequest.calls.mostRecent().args[0];
    expect(payload).toEqual(
      jasmine.objectContaining({
        type: 'FEEDBACK',
        subject: 'Feedback · Finanças · nota 4/5',
        rating: 4,
        area: 'FINANCES',
        canContact: true,
        screenPath: '/feedback',
        appVersion: APP_VERSION,
      }),
    );
    expect(payload.message).toBe(
      'O que funcionou bem:\nGostei da rosca de gastos.\n\nO que atrapalhou ou faltou:\nFaltou criar categoria nova.',
    );
    expect(payload.deviceInfo).toContain('viewport=');
  });

  it('sem marcar o contato, canContact vai falso', () => {
    clickRating(3);
    write('feedback-liked', 'Gostei de varias coisas.');
    submit();

    expect(api.createSupportRequest.calls.mostRecent().args[0].canContact).toBe(false);
  });

  it('mostra o agradecimento depois de enviar e permite enviar outro', () => {
    clickRating(5);
    write('feedback-liked', 'Muito bom, gostei do app.');
    submit();

    expect(text()).toContain('Obrigado! Seu feedback chegou.');
    expect(root().querySelector('form')).toBeNull();

    const another = Array.from(root().querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Enviar outro'),
    ) as HTMLButtonElement;
    another.click();
    fixture.detectChanges();

    expect(root().querySelector('form')).not.toBeNull();
    expect((root().querySelector('#feedback-liked') as HTMLTextAreaElement).value).toBe('');
    expect(root().querySelector('.feedback-rating__option.is-selected')).toBeNull();
  });

  it('avisa que o feedback ficou guardado quando esta sem conexao', () => {
    api.createSupportRequest.and.returnValue(of(created('offline-support-123')));
    clickRating(4);
    write('feedback-liked', 'Gostei do app em geral.');
    submit();

    expect(text()).toContain('sem conexão');
    expect(text()).toContain('enviado sozinho');
  });

  it('se o servidor recusar, mantem o texto e mostra o erro', () => {
    api.createSupportRequest.and.returnValue(
      throwError(() => ({ status: 429, error: { message: 'Muitos envios em pouco tempo.' } })),
    );
    clickRating(4);
    write('feedback-liked', 'Gostei do app em geral.');
    submit();

    expect(text()).toContain('Muitos envios em pouco tempo.');
    expect(root().querySelector('form')).not.toBeNull();
    expect((root().querySelector('#feedback-liked') as HTMLTextAreaElement).value).toContain('Gostei do app');
  });

  it('nao envia duas vezes com duplo clique', () => {
    // Fica "enviando": a resposta nunca chega.
    api.createSupportRequest.and.returnValue(new Subject<SupportRequest>());
    clickRating(4);
    write('feedback-liked', 'Gostei do app em geral.');

    submit();
    submit();

    expect(api.createSupportRequest).toHaveBeenCalledTimes(1);
  });
});
