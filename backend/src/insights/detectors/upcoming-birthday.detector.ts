import { InsightSeverity, InsightType } from '@prisma/client';
import { differenceInCalendarDays, startOfDay } from 'date-fns';
import { InsightContext } from '../context/insight-context.types';
import { GeneratedInsight } from '../insight.types';

const BIRTHDAY_WINDOW_DAYS = 7;

/**
 * birthDate e um campo so-de-data, gravado a meia-noite UTC — ler mes/dia
 * com getMonth()/getDate() (fuso local do processo) pode voltar um dia
 * quando o servidor roda a oeste de UTC (ex: America/Sao_Paulo faz
 * 21/09T00:00Z virar 20/09 as 21h local). getUTCMonth()/getUTCDate()
 * leem o dia civil como foi gravado, sem esse deslize.
 */
function daysUntilNextBirthday(birthDate: Date, now: Date): number | null {
  if (Number.isNaN(birthDate.getTime())) return null;

  const nextBirthday = new Date(now.getFullYear(), birthDate.getUTCMonth(), birthDate.getUTCDate());
  if (nextBirthday < startOfDay(now)) {
    nextBirthday.setFullYear(nextBirthday.getFullYear() + 1);
  }
  return differenceInCalendarDays(nextBirthday, now);
}

const whenLabel = (days: number): string => (days === 0 ? 'hoje' : days === 1 ? 'amanha' : `em ${days} dias`);

/**
 * Usa o birthDate declarado no cadastro/configuracoes. So avisa dentro de
 * uma janela de 7 dias — fora dela nao ha o que fazer com a informacao.
 */
export function detectUpcomingBirthday(context: InsightContext): GeneratedInsight | null {
  const { user, now } = context;
  if (!user.birthDate) return null;

  const daysUntil = daysUntilNextBirthday(user.birthDate, now);
  if (daysUntil === null || daysUntil > BIRTHDAY_WINDOW_DAYS) return null;

  return {
    type: InsightType.ROUTINE,
    key: 'birthday_soon',
    severity: InsightSeverity.INFO,
    message: `Seu aniversario e ${whenLabel(daysUntil)}. Bom momento pra revisar metas de vida e comemorar o progresso ate aqui.`,
    metadata: { daysUntil },
  };
}
