import { PUBLIC_SITE_URL } from '../constants/site.constants';

/**
 * Destino do QR code. `utm_source=qr` marca a origem do acesso: hoje o site nao
 * tem analytics, mas qualquer ferramenta que entrar depois ja separa quem veio
 * do QR. Mantido curto de proposito: menos caracteres = menos quadradinhos = leitura
 * mais confiavel em tamanho pequeno.
 */
export function qrTargetUrl(siteUrl: string = PUBLIC_SITE_URL) {
  return `${siteUrl.replace(/\/+$/, '')}/?utm_source=qr`;
}

/** Endereco legivel para imprimir abaixo do QR (sem protocolo). */
export function displayHost(siteUrl: string = PUBLIC_SITE_URL) {
  return siteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}
