import { parseEnvelopeBody } from './envelope.parser';

describe('parseEnvelopeBody', () => {
  it.each([
    ['', { ok: true, name: null, monthlyCents: null }],
    ['400 gasolina', { ok: true, name: 'gasolina', monthlyCents: 40000 }],
    ['gasolina', { ok: true, name: 'gasolina', monthlyCents: null }],
    ['3 mil viagem', { ok: true, name: 'viagem', monthlyCents: 300000 }],
    ['R$ 50 mercado', { ok: true, name: 'mercado', monthlyCents: 5000 }],
    ['400', { ok: true, name: null, monthlyCents: 40000 }],
    // Número depois do nome não é valor (contrato 4): fica no nome.
    ['gasolina 400', { ok: true, name: 'gasolina 400', monthlyCents: null }],
    ['1000000 x', { ok: true, name: 'x', monthlyCents: 100000000 }],
  ])('"%s"', (body, expected) => {
    expect(parseEnvelopeBody(body)).toEqual(expected);
  });

  it.each([
    ['0 gasolina', 'ZERO'],
    ['-5 gasolina', 'NEGATIVE'],
    ['1,234 gasolina', 'AMBIGUOUS'],
    ['2.000.000 gasolina', 'TOO_LARGE'],
  ])('valor inválido recusado: "%s" (%s)', (body, reason) => {
    expect(parseEnvelopeBody(body)).toEqual({ ok: false, reason });
  });
});
