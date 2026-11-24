/**
 * Mascara o chat.id para logs e para o app: primeiros dois e ultimos dois digitos, o resto em bullets.
 * O chat.id inteiro nunca aparece fora do banco (contrato 10, D1/D7).
 */
export function maskChatId(chatId: string | bigint): string {
  const digits = typeof chatId === 'bigint' ? chatId.toString() : chatId;
  if (!/^\d+$/.test(digits) || digits.length <= 4) return '••••';
  return `${digits.slice(0, 2)}${'•'.repeat(digits.length - 4)}${digits.slice(-2)}`;
}
