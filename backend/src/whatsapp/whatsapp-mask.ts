/**
 * Mascara um JID `5511999990000@s.whatsapp.net` para `+55 11 *****-0000`.
 * Usado em logs e no status. Formato estranho vira '***'.
 */
export function maskJid(jid: string | null | undefined): string {
  const digits = (jid ?? '').split('@')[0] ?? '';
  if (!/^\d{12,13}$/.test(digits) || !digits.startsWith('55')) {
    return '***';
  }
  const country = digits.slice(0, 2);
  const ddd = digits.slice(2, 4);
  const last4 = digits.slice(-4);
  return `+${country} ${ddd} *****-${last4}`;
}
