import { registerDecorator, ValidationOptions } from 'class-validator';
import { sniffMime } from '../utils/file-sniff';

// Vazio limpa a foto; senao so data URL de PNG/JPEG/WEBP/GIF.
const AVATAR_PATTERN = /^$|^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export function isAvatarDataUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !AVATAR_PATTERN.test(value)) {
    return false;
  }

  if (value === '') {
    return true;
  }

  const declared = value.slice(5, value.indexOf(';')).replace('jpg', 'jpeg');
  const head = Buffer.from(value.slice(value.indexOf(',') + 1, value.indexOf(',') + 65), 'base64');

  return sniffMime(head) === declared;
}

export function IsAvatarDataUrl(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isAvatarDataUrl',
      target: object.constructor,
      propertyName,
      options: {
        message: 'A foto de perfil deve ser uma imagem PNG, JPEG, WEBP ou GIF.',
        ...options,
      },
      validator: { validate: isAvatarDataUrl },
    });
}
