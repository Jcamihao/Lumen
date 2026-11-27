import { DashboardSummary } from '../assistant.types';
import { sanitizeExternalText } from '../text/sanitize';

/**
 * Perfil pessoal declarado no cadastro/configuracoes — permite que o
 * Selah personalize conselhos por faixa etaria, profissao e o objetivo
 * que o usuario disse ter ao entrar no LUMEN, em vez de falar generico.
 */
export function describeUserProfile(user: DashboardSummary["user"]) {
  const parts: string[] = [];

  const age = calculateAge(user.birthDate);
  if (age !== null) {
    parts.push(`${age} anos`);
  }

  if (user.occupation) {
    parts.push(sanitizeExternalText(user.occupation));
  }

  if (parts.length === 0 && !user.primaryGoal) {
    return "";
  }

  const profileLine = parts.length
    ? `Perfil pessoal: ${parts.join(", ")}.`
    : "";
  const goalLine = user.primaryGoal
    ? `Objetivo principal declarado no cadastro: "${sanitizeExternalText(user.primaryGoal)}".`
    : "";

  return [profileLine, goalLine].filter(Boolean).join("\n");
}

/**
 * birthDate e um campo so-de-data, gravado a meia-noite UTC — ler com
 * getFullYear()/getMonth()/getDate() (fuso local do processo) pode voltar
 * um dia quando o servidor roda a oeste de UTC (ex: America/Sao_Paulo faz
 * 01/01T00:00Z virar 31/12 as 21h local, subtraindo 1 ano errado da
 * idade). Os metodos UTC leem o dia civil exatamente como foi gravado.
 */
export function calculateAge(birthDate: Date | string | null | undefined) {
  if (!birthDate) return null;

  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - birth.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getUTCMonth() ||
    (now.getMonth() === birth.getUTCMonth() && now.getDate() >= birth.getUTCDate());

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}
