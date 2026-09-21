export type FeedbackArea =
  | 'HOME'
  | 'TASKS'
  | 'FINANCES'
  | 'GOALS'
  | 'SELAH'
  | 'IMPORTS'
  | 'SETTINGS'
  | 'ONBOARDING'
  | 'GENERAL';

export type FeedbackAreaOption = { value: FeedbackArea; label: string; icon: string };

/** Mesmas areas aceitas pelo backend (feedback-areas.ts). */
export const FEEDBACK_AREAS: FeedbackAreaOption[] = [
  { value: 'HOME', label: 'Início', icon: 'space_dashboard' },
  { value: 'TASKS', label: 'Tarefas', icon: 'checklist' },
  { value: 'FINANCES', label: 'Finanças', icon: 'account_balance_wallet' },
  { value: 'GOALS', label: 'Metas', icon: 'flag' },
  { value: 'SELAH', label: 'Selah', icon: 'auto_awesome' },
  { value: 'IMPORTS', label: 'Importar', icon: 'upload_file' },
  { value: 'SETTINGS', label: 'Configurações', icon: 'settings' },
  { value: 'ONBOARDING', label: 'Cadastro e login', icon: 'login' },
  { value: 'GENERAL', label: 'Geral', icon: 'apps' },
];

export const RATING_OPTIONS = [
  { value: 1, label: 'Ruim' },
  { value: 2, label: 'Regular' },
  { value: 3, label: 'Ok' },
  { value: 4, label: 'Bom' },
  { value: 5, label: 'Ótimo' },
] as const;

/** Minimo de caracteres do texto final (o backend exige 12 na mensagem). */
export const FEEDBACK_MIN_TEXT = 12;
export const FEEDBACK_MAX_FIELD = 2000;

export function areaLabel(area: string | null | undefined) {
  return FEEDBACK_AREAS.find((option) => option.value === area)?.label ?? 'Geral';
}

/** Rota de origem -> area do app; usada para ja marcar a parte que o testador estava usando. */
export function areaFromUrl(url: string | null | undefined): FeedbackArea {
  const path = (url ?? '').split('?')[0].split('#')[0];

  const matches = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

  if (path === '' || path === '/' || matches('/dashboard')) return 'HOME';
  if (matches('/tasks')) return 'TASKS';
  if (matches('/finance') || matches('/finances')) return 'FINANCES';
  if (matches('/goals')) return 'GOALS';
  if (matches('/assistant') || matches('/selah')) return 'SELAH';
  if (matches('/imports')) return 'IMPORTS';
  if (matches('/settings')) return 'SETTINGS';
  if (path.startsWith('/auth')) return 'ONBOARDING';

  return 'GENERAL';
}

/** Junta os dois campos numa mensagem legivel, so com as secoes preenchidas. */
export function buildFeedbackMessage(liked: string, improve: string) {
  const sections: string[] = [];

  if (liked.trim()) {
    sections.push(`O que funcionou bem:\n${liked.trim()}`);
  }

  if (improve.trim()) {
    sections.push(`O que atrapalhou ou faltou:\n${improve.trim()}`);
  }

  return sections.join('\n\n');
}

export function feedbackSubject(area: string, rating: number) {
  return `Feedback · ${areaLabel(area)} · nota ${rating}/5`;
}
