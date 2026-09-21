import { OnboardingProgress } from '../models/domain.models';

export type OnboardingStepId = keyof OnboardingProgress;

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  route: string;
  cta: string;
  done: boolean;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  percent: number;
  allDone: boolean;
  /** Ja existe alguma tarefa, movimentacao ou meta: so entao ha dado real para a pontuacao e o destaque do dia. */
  hasActivity: boolean;
  nextStep: OnboardingStep | null;
};

const STEP_DEFINITIONS: Array<Omit<OnboardingStep, 'done'>> = [
  {
    id: 'tasks',
    title: 'Crie sua primeira tarefa',
    description: 'Anote o que precisa fazer e o prazo. O Selah avisa quando algo atrasar.',
    route: '/tasks',
    cta: 'Criar tarefa',
  },
  {
    id: 'transactions',
    title: 'Registre um gasto ou uma receita',
    description: 'É o que alimenta o saldo, a rosca de gastos e os alertas do Selah.',
    route: '/finances',
    cta: 'Registrar',
  },
  {
    id: 'goals',
    title: 'Defina uma meta',
    description: 'Guardar para uma viagem, montar uma reserva, quitar uma dívida: o Lumen acompanha o progresso.',
    route: '/goals',
    cta: 'Criar meta',
  },
  {
    id: 'recurring',
    title: 'Cadastre uma conta fixa',
    description: 'Aluguel, internet, salário: o lançamento entra sozinho no dia do vencimento.',
    route: '/finances',
    cta: 'Cadastrar',
  },
  {
    id: 'selah',
    title: 'Converse com o Selah',
    description: 'Pergunte "como está meu mês?" e veja uma leitura feita com os seus dados.',
    route: '/assistant',
    cta: 'Conversar',
  },
];

/** Devolve null quando nao ha informacao (resumo offline ou antigo): nesse caso nada de onboarding. */
export function buildOnboarding(progress: OnboardingProgress | undefined | null): OnboardingState | null {
  if (!progress) {
    return null;
  }

  const steps = STEP_DEFINITIONS.map((definition) => ({
    ...definition,
    done: Boolean(progress[definition.id]),
  }));
  const doneCount = steps.filter((step) => step.done).length;

  return {
    steps,
    doneCount,
    total: steps.length,
    percent: Math.round((doneCount / steps.length) * 100),
    allDone: doneCount === steps.length,
    hasActivity: Boolean(progress.tasks || progress.transactions || progress.goals),
    nextStep: steps.find((step) => !step.done) ?? null,
  };
}
