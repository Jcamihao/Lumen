export const EMAIL_CATEGORIES = [
  "weekly_digest",
  "reminders",
  "insight_alerts",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const EMAIL_CATEGORY_FIELD = {
  weekly_digest: "emailWeeklyDigest",
  reminders: "emailReminders",
  insight_alerts: "emailInsightAlerts",
} as const;

export type EmailPreferenceSubject = {
  emailVerifiedAt?: Date | null;
  emailWeeklyDigest?: boolean | null;
  emailReminders?: boolean | null;
  emailInsightAlerts?: boolean | null;
};

/**
 * Emails automaticos (lembrete, resumo semanal, alerta) so saem para
 * enderecos confirmados e enquanto o usuario nao desligou a categoria.
 * Emails transacionais (confirmacao, senha, MFA) nao passam por aqui.
 */
export function canSendAutomatedEmail(
  user: EmailPreferenceSubject | null | undefined,
  category: EmailCategory,
) {
  if (!user || !user.emailVerifiedAt) {
    return false;
  }

  return user[EMAIL_CATEGORY_FIELD[category]] !== false;
}
