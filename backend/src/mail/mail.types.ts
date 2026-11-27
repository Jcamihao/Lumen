export type SendEmailOptions = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  tags?: string[];
  replyTo?: string;
  headers?: Record<string, string>;
};

export type UnsubscribeLinks = {
  /** Pagina do frontend que confirma o descadastro (link visivel no rodape). */
  pageUrl: string;
  /** Endpoint POST da API para o one-click do cliente de email (RFC 8058). */
  oneClickUrl: string;
};

export type MailDispatchResult = {
  provider: "resend";
  skipped: boolean;
  statusCode?: number;
  id?: string;
  message: string;
};

/** Contexto de montagem dos emails (o que vem da configuracao, nao do destinatario). */
export type EmailContext = { frontendUrl: string };

export type WelcomeEmailInput = {
  email: string;
  name: string;
  verifyUrl?: string;
};

export type EmailVerificationInput = {
  email: string;
  name?: string | null;
  verifyUrl: string;
  expiresInHours: number;
};

export type PasswordResetEmailInput = {
  email: string;
  name?: string | null;
  resetUrl: string;
  expiresInMinutes: number;
};

export type PasswordChangedEmailInput = {
  email: string;
  name?: string | null;
};

export type ReminderEmailInput = {
  email: string;
  name?: string | null;
  title: string;
  contextTitle?: string | null;
  remindAt: Date;
  timezone?: string | null;
  unsubscribe?: UnsubscribeLinks;
};

export type InsightEscalationEmailInput = {
  email: string;
  name?: string | null;
  message: string;
  unsubscribe?: UnsubscribeLinks;
};

export type WeeklyDigestEmailInput = {
  email: string;
  name?: string | null;
  preferredCurrency: string;
  overdueTasksCount: number;
  balance: number;
  monthlyExpenses: number;
  monthlyIncome: number;
  goals: { title: string; currentAmount: number; targetAmount: number | null }[];
  unsubscribe?: UnsubscribeLinks;
};

export type BillDueEmailInput = {
  email: string;
  name?: string | null;
  preferredCurrency: string;
  bills: { description: string; amount: number; dueDate: Date; daysUntil: number }[];
  unsubscribe?: UnsubscribeLinks;
};

export type MfaBypassEmailInput = {
  email: string;
  name?: string | null;
  otp: string;
};
