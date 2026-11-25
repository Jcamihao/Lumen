import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetSharingDto } from './set-sharing.dto';

async function check(body: unknown) {
  const dto = plainToInstance(SetSharingDto, body, { enableImplicitConversion: true });
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
}

describe('SetSharingDto', () => {
  it('aceita booleano de verdade', async () => {
    expect((await check({ shared: true })).errors).toHaveLength(0);
    const { dto, errors } = await check({ shared: false });
    expect(errors).toHaveLength(0);
    expect(dto.shared).toBe(false);
  });

  it.each(['false', 'true', 'yes', 0, 1, null])('rejeita %p (a conversao implicita nao pode virar true)', async (value) => {
    expect((await check({ shared: value })).errors.length).toBeGreaterThan(0);
  });

  it('rejeita corpo sem o campo', async () => {
    expect((await check({})).errors.length).toBeGreaterThan(0);
  });
});
