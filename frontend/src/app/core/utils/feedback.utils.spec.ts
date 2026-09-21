import {
  FEEDBACK_AREAS,
  areaFromUrl,
  areaLabel,
  buildFeedbackMessage,
  feedbackSubject,
} from './feedback.utils';

describe('feedback utils', () => {
  describe('areaFromUrl', () => {
    it('mapeia as rotas do app para a area certa', () => {
      expect(areaFromUrl('/dashboard')).toBe('HOME');
      expect(areaFromUrl('/')).toBe('HOME');
      expect(areaFromUrl('/tasks')).toBe('TASKS');
      expect(areaFromUrl('/finance')).toBe('FINANCES');
      expect(areaFromUrl('/finances')).toBe('FINANCES');
      expect(areaFromUrl('/goals')).toBe('GOALS');
      expect(areaFromUrl('/assistant')).toBe('SELAH');
      expect(areaFromUrl('/imports')).toBe('IMPORTS');
      expect(areaFromUrl('/settings')).toBe('SETTINGS');
      expect(areaFromUrl('/auth/login')).toBe('ONBOARDING');
    });

    it('ignora query string e subrotas', () => {
      expect(areaFromUrl('/finances?search=aluguel')).toBe('FINANCES');
      expect(areaFromUrl('/tasks/123')).toBe('TASKS');
    });

    it('nao confunde rotas parecidas e cai em Geral quando nao conhece', () => {
      expect(areaFromUrl('/taskshop')).toBe('GENERAL');
      expect(areaFromUrl('/support')).toBe('GENERAL');
      expect(areaFromUrl(null)).toBe('HOME');
      expect(areaFromUrl(undefined)).toBe('HOME');
    });
  });

  describe('buildFeedbackMessage', () => {
    it('inclui so as secoes preenchidas, com rotulo', () => {
      expect(buildFeedbackMessage('Gostei da rosca', '')).toBe('O que funcionou bem:\nGostei da rosca');
      expect(buildFeedbackMessage('', 'Faltou filtro')).toBe('O que atrapalhou ou faltou:\nFaltou filtro');
    });

    it('junta as duas com uma linha em branco e apara espacos', () => {
      expect(buildFeedbackMessage('  Gostei  ', '  Faltou  ')).toBe(
        'O que funcionou bem:\nGostei\n\nO que atrapalhou ou faltou:\nFaltou',
      );
    });

    it('devolve vazio quando nao ha texto', () => {
      expect(buildFeedbackMessage('   ', '')).toBe('');
    });
  });

  it('monta o assunto com area e nota', () => {
    expect(feedbackSubject('FINANCES', 4)).toBe('Feedback · Finanças · nota 4/5');
  });

  it('rotula areas e usa Geral como padrao', () => {
    expect(areaLabel('SELAH')).toBe('Selah');
    expect(areaLabel('inexistente')).toBe('Geral');
    expect(areaLabel(null)).toBe('Geral');
  });

  it('tem exatamente as areas que o backend aceita', () => {
    expect(FEEDBACK_AREAS.map((option) => option.value)).toEqual([
      'HOME', 'TASKS', 'FINANCES', 'GOALS', 'SELAH', 'IMPORTS', 'SETTINGS', 'ONBOARDING', 'GENERAL',
    ]);
  });
});
