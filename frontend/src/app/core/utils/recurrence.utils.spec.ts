import {
  dueDateLabel,
  daysUntilDue,
  frequencyName,
  recurrenceLabel,
  recurringStatus,
} from './recurrence.utils';

describe('recurrence utils', () => {
  it('descreve cada frequencia em portugues', () => {
    expect(recurrenceLabel({ frequency: 'MONTHLY', anchorDay: 5, nextDueDate: '2026-10-05T00:00:00.000Z' })).toBe(
      'Todo mês, dia 5',
    );
    // 05/10/2026 e segunda-feira.
    expect(recurrenceLabel({ frequency: 'WEEKLY', anchorDay: 5, nextDueDate: '2026-10-05T00:00:00.000Z' })).toBe(
      'Toda segunda',
    );
    expect(recurrenceLabel({ frequency: 'YEARLY', anchorDay: 5, nextDueDate: '2027-03-05T00:00:00.000Z' })).toBe(
      'Todo ano, 5 de março',
    );
  });

  it('nao desloca o dia por causa do fuso do navegador', () => {
    // Meia-noite UTC, lida em UTC: dia 1, nunca "31 do mes anterior".
    expect(recurrenceLabel({ frequency: 'YEARLY', anchorDay: 1, nextDueDate: '2027-01-01T00:00:00.000Z' })).toBe(
      'Todo ano, 1 de janeiro',
    );
    expect(dueDateLabel('2026-10-01T00:00:00.000Z')).toBe('01/10/2026');
  });

  it('nomeia a frequencia', () => {
    expect(frequencyName('WEEKLY')).toBe('Semanal');
    expect(frequencyName('MONTHLY')).toBe('Mensal');
    expect(frequencyName('YEARLY')).toBe('Anual');
  });

  it('distingue ativa, pausada e encerrada', () => {
    expect(recurringStatus({ isActive: true, nextDueDate: '2026-10-05T00:00:00.000Z', endDate: null })).toBe('active');
    expect(recurringStatus({ isActive: false, nextDueDate: '2026-10-05T00:00:00.000Z', endDate: null })).toBe('paused');
    // Pausada ainda dentro do prazo continua "pausada".
    expect(
      recurringStatus({ isActive: false, nextDueDate: '2026-10-05T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' }),
    ).toBe('paused');
    // Proximo vencimento passou da data final: encerrada.
    expect(
      recurringStatus({ isActive: false, nextDueDate: '2027-01-05T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z' }),
    ).toBe('ended');
  });

  it('conta dias ate o vencimento no calendario local', () => {
    const today = new Date(2026, 8, 20, 23, 30); // 20/09 as 23:30 local
    expect(daysUntilDue('2026-09-21T00:00:00.000Z', today)).toBe(1);
    expect(daysUntilDue('2026-09-23T00:00:00.000Z', today)).toBe(3);
    expect(daysUntilDue('2026-09-20T00:00:00.000Z', today)).toBe(0);
  });
});
