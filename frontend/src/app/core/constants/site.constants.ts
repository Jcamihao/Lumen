/**
 * Endereco publico oficial do Lumen. Fixo de proposito: o QR code impresso tem
 * de apontar para producao mesmo quando a pagina e aberta em localhost ou em
 * homologacao (window.location.origin geraria um QR que nao funciona na rua).
 */
export const PUBLIC_SITE_URL = 'https://financelumen.tech';
