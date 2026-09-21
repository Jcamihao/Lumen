/** Resumo do aparelho para acompanhar feedback e bug report (plataforma, tela e navegador). */
export function buildDeviceInfo() {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const platform = typeof navigator !== 'undefined' ? navigator.platform : 'unknown';
  const viewport =
    typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown';

  return `platform=${platform}; viewport=${viewport}; userAgent=${userAgent}`;
}
