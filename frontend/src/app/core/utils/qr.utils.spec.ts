import { displayHost, qrTargetUrl } from './qr.utils';

describe('qr utils', () => {
  it('aponta para producao com a marca de origem', () => {
    expect(qrTargetUrl()).toBe('https://financelumen.tech/?utm_source=qr');
  });

  it('nao duplica a barra final do endereco', () => {
    expect(qrTargetUrl('https://exemplo.com/')).toBe('https://exemplo.com/?utm_source=qr');
    expect(qrTargetUrl('https://exemplo.com///')).toBe('https://exemplo.com/?utm_source=qr');
  });

  it('mostra o endereco sem protocolo', () => {
    expect(displayHost()).toBe('financelumen.tech');
    expect(displayHost('http://exemplo.com/')).toBe('exemplo.com');
  });
});
