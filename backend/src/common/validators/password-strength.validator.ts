import { registerDecorator, ValidationOptions } from 'class-validator';

// Senhas que aparecem em todo vazamento (ja com 8+ caracteres, que e o minimo).
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '12345678910', '123123123', '987654321', '87654321',
  '11111111', '22222222', '00000000', '88888888', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4',
  'qwertyui', 'qwertyuiop', 'qwerty123', 'qwer1234', 'asdfghjk', 'zxcvbnm1', 'abc12345',
  'abcd1234', 'abcdefgh', 'password', 'password1', 'password123', 'passw0rd', 'senha123',
  'senha1234', 'senha@123', 'minhasenha', 'mudar123', 'brasil123', 'flamengo', 'corinthians',
  'palmeiras', 'saopaulo', 'cruzeiro', 'iloveyou', 'admin123', 'administrador', 'welcome1',
  'letmein1', 'football', 'master123', 'lumen123', 'lumen1234', 'lumen@123', 'financelumen',
]);

export function isStrongEnoughPassword(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.toLowerCase();

  if (COMMON_PASSWORDS.has(normalized)) {
    return false;
  }

  // "aaaaaaaa", "abababab": um ou dois caracteres repetidos nao sao senha.
  return new Set(normalized).size >= 3;
}

export function IsStrongPassword(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: {
        message: 'Essa senha e muito comum ou repetitiva. Escolha outra.',
        ...options,
      },
      validator: { validate: isStrongEnoughPassword },
    });
}
