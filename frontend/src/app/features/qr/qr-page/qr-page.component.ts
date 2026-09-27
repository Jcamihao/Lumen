import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { displayHost, qrTargetUrl } from '../../../core/utils/qr.utils';

// Sempre preto sobre branco: leitor de QR nao le bem invertido, nem em tema escuro.
const QR_OPTIONS = {
  errorCorrectionLevel: 'Q' as const,
  margin: 4,
  color: { dark: '#000000', light: '#ffffff' },
};

/** 2048 px: nitido em cartaz A3; a tela mostra reduzido pelo CSS. */
const PNG_SIZE = 2048;

@Component({
    selector: 'app-qr-page',
    imports: [CommonModule, RouterLink],
    templateUrl: './qr-page.component.html',
    styleUrls: ['./qr-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class QrPageComponent {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly target = qrTargetUrl();
  protected readonly host = displayHost();
  protected readonly pngUrl = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly copied = signal<'idle' | 'ok' | 'error'>('idle');

  private svgMarkup = '';

  constructor() {
    // Ferramenta de divulgacao, nao conteudo: fora do Google.
    this.title.setTitle('QR code do Lumen');
    const robots = this.meta.addTag({ name: 'robots', content: 'noindex' });
    this.destroyRef.onDestroy(() => {
      if (robots) {
        this.meta.removeTagElement(robots);
      }
    });

    void this.generate();
  }

  protected downloadPng() {
    const url = this.pngUrl();
    if (url) {
      this.download(url, 'lumen-qrcode.png');
    }
  }

  protected downloadSvg() {
    if (!this.svgMarkup) {
      return;
    }

    const blobUrl = URL.createObjectURL(new Blob([this.svgMarkup], { type: 'image/svg+xml' }));
    this.download(blobUrl, 'lumen-qrcode.svg');
    URL.revokeObjectURL(blobUrl);
  }

  protected print() {
    window.print();
  }

  protected async copyLink() {
    try {
      await navigator.clipboard.writeText(this.target);
      this.copied.set('ok');
    } catch {
      this.copied.set('error');
    }
  }

  private async generate() {
    try {
      // A biblioteca so carrega nesta pagina (mesmo padrao do QR do MFA).
      // Desestruturado: `QRCode.toString` no namespace colide com Object.prototype.toString no tipo.
      const { toDataURL, toString: toSvgString } = await import('qrcode');
      const [png, svg] = await Promise.all([
        toDataURL(this.target, { ...QR_OPTIONS, width: PNG_SIZE }),
        toSvgString(this.target, { ...QR_OPTIONS, type: 'svg' }),
      ]);

      this.svgMarkup = svg;
      this.pngUrl.set(png);
    } catch {
      this.failed.set(true);
    }
  }

  private download(href: string, filename: string) {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.click();
  }
}
