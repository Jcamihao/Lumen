/** Areas do app que o testador pode apontar no feedback (valor gravado no banco). */
export const FEEDBACK_AREAS = [
  'HOME',
  'TASKS',
  'FINANCES',
  'GOALS',
  'SELAH',
  'IMPORTS',
  'SETTINGS',
  'ONBOARDING',
  'GENERAL',
] as const;

export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];
