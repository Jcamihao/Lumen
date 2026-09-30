import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ToastService } from '../../core/services/toast.service';
import { ToastComponent } from './toast.component';

describe('ToastComponent', () => {
  let fixture: ComponentFixture<ToastComponent>;
  let toastService: ToastService;

  const root = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ToastComponent],
      providers: [provideRouter([])],
    });

    fixture = TestBed.createComponent(ToastComponent);
    toastService = TestBed.inject(ToastService);
    fixture.detectChanges();
  });

  it('sem action, nao renderiza link nenhum no toast', () => {
    toastService.error('Deu ruim.');
    fixture.detectChanges();

    expect(root().querySelector('.toast__action')).toBeNull();
  });

  it('com action, renderiza um link clicavel com o label e a rota', () => {
    toastService.errorWithAction('Limite do plano atingido.', { label: 'Ver planos', route: '/plano' });
    fixture.detectChanges();

    const link = root().querySelector('.toast__action') as HTMLAnchorElement;
    expect(link).withContext('link da action deveria existir').not.toBeNull();
    expect(link.textContent?.trim()).toBe('Ver planos');
    expect(link.getAttribute('href')).toBe('/plano');
  });

  it('clicar no link da action tambem descarta o toast', () => {
    toastService.errorWithAction('Limite do plano atingido.', { label: 'Ver planos', route: '/plano' });
    fixture.detectChanges();

    const link = root().querySelector('.toast__action') as HTMLAnchorElement;
    link.click();
    fixture.detectChanges();

    expect(toastService.toasts().length).toBe(0);
  });
});
