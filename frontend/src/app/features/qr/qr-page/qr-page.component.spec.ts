import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { QrPageComponent } from './qr-page.component';

describe('QrPageComponent', () => {
  let fixture: ComponentFixture<QrPageComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('.qr-tools button')).find((item) =>
      item.textContent?.includes(label),
    )!;

  // A biblioteca de QR carrega sob demanda: espera o resultado aparecer de verdade.
  const settle = async () => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await fixture.whenStable();
      fixture.detectChanges();

      if (root().querySelector('.qr-poster__code') || root().querySelector('.qr-poster__error')) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [QrPageComponent],
      providers: [provideRouter([])],
    });

    fixture = TestBed.createComponent(QrPageComponent);
    fixture.detectChanges();
  });

  it('enquanto gera, avisa e deixa baixar/imprimir desligados', () => {
    expect(root().textContent).toContain('Gerando o QR code');
    expect(button('Baixar PNG').disabled).toBeTrue();
    expect(button('Baixar SVG').disabled).toBeTrue();
    expect(button('Imprimir').disabled).toBeTrue();
  });

  it('mostra o QR como imagem PNG e liga os botoes quando pronto', async () => {
    await settle();

    const image = root().querySelector<HTMLImageElement>('.qr-poster__code');
    expect(image?.src).toMatch(/^data:image\/png;base64,/);
    expect(image?.alt).toContain('QR code');
    expect(button('Baixar PNG').disabled).toBeFalse();
    expect(root().textContent).not.toContain('Gerando o QR code');
  });

  it('o cartaz traz a chamada e o endereco legivel', async () => {
    await settle();

    const text = root().querySelector('.qr-poster')?.textContent ?? '';
    expect(text).toContain('Organize sua vida com o Lumen');
    expect(text).toContain('Aponte a câmera do celular');
    expect(text).toContain('financelumen.tech');
  });

  it('baixar PNG usa o nome certo', async () => {
    await settle();
    const clicks: Array<{ download: string; href: string }> = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    });

    button('Baixar PNG').click();

    expect(clicks.length).toBe(1);
    expect(clicks[0].download).toBe('lumen-qrcode.png');
    expect(clicks[0].href).toMatch(/^data:image\/png/);
  });

  it('baixar SVG entrega um arquivo vetorial', async () => {
    await settle();
    const clicks: Array<{ download: string; href: string }> = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    });

    button('Baixar SVG').click();

    expect(clicks[0].download).toBe('lumen-qrcode.svg');
    expect(clicks[0].href).toMatch(/^blob:/);
  });

  it('imprimir abre a impressao do navegador', async () => {
    await settle();
    const print = spyOn(window, 'print');

    button('Imprimir').click();

    expect(print).toHaveBeenCalledTimes(1);
  });

  describe('copiar link', () => {
    const setClipboard = (writeText: () => Promise<void>) =>
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    it('confirma quando copia', async () => {
      const writeText = jasmine.createSpy('writeText').and.resolveTo();
      setClipboard(writeText);

      button('Copiar link').click();
      await settle();

      expect(writeText).toHaveBeenCalledWith('https://financelumen.tech/?utm_source=qr');
      expect(root().textContent).toContain('Link copiado');
    });

    it('se o navegador nao deixar, mostra o link para copiar na mao', async () => {
      setClipboard(() => Promise.reject(new Error('bloqueado')));

      button('Copiar link').click();
      await settle();

      expect(root().textContent).toContain('Não deu para copiar');
      expect(root().textContent).toContain('https://financelumen.tech/?utm_source=qr');
    });
  });

  it('fica fora do Google (noindex) enquanto a pagina esta aberta', () => {
    const robots = () => document.head.querySelector('meta[name="robots"][content="noindex"]');

    expect(robots()).not.toBeNull();

    fixture.destroy();

    expect(robots()).toBeNull();
  });
});
