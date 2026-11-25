import { maskJid } from './whatsapp-mask';

describe('maskJid', () => {
  it('mantem pais, DDD e ultimos 4 digitos', () => {
    expect(maskJid('5511999990000@s.whatsapp.net')).toBe('+55 11 *****-0000');
  });

  it('formato estranho vira ***', () => {
    expect(maskJid('abc@s.whatsapp.net')).toBe('***');
    expect(maskJid('')).toBe('***');
    expect(maskJid(null)).toBe('***');
  });
});
