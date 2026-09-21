import { OnboardingProgress } from '../models/domain.models';
import { buildOnboarding } from './onboarding.utils';

const progress = (overrides: Partial<OnboardingProgress> = {}): OnboardingProgress => ({
  tasks: false,
  transactions: false,
  goals: false,
  recurring: false,
  selah: false,
  ...overrides,
});

describe('buildOnboarding', () => {
  it('nao ha onboarding quando nao ha informacao (offline ou resumo antigo)', () => {
    expect(buildOnboarding(undefined)).toBeNull();
    expect(buildOnboarding(null)).toBeNull();
  });

  it('conta nova: 0 de 5, sem atividade, proximo passo e criar tarefa', () => {
    const state = buildOnboarding(progress())!;

    expect(state.doneCount).toBe(0);
    expect(state.total).toBe(5);
    expect(state.percent).toBe(0);
    expect(state.hasActivity).toBeFalse();
    expect(state.allDone).toBeFalse();
    expect(state.nextStep?.id).toBe('tasks');
  });

  it('marca cada passo pelo dado real e calcula o progresso', () => {
    const state = buildOnboarding(progress({ tasks: true, goals: true }))!;

    expect(state.steps.filter((step) => step.done).map((step) => step.id)).toEqual(['tasks', 'goals']);
    expect(state.doneCount).toBe(2);
    expect(state.percent).toBe(40);
    expect(state.nextStep?.id).toBe('transactions');
  });

  it('atividade = tarefa, movimentacao ou meta (conta fixa e Selah sozinhos nao contam)', () => {
    expect(buildOnboarding(progress({ tasks: true }))!.hasActivity).toBeTrue();
    expect(buildOnboarding(progress({ transactions: true }))!.hasActivity).toBeTrue();
    expect(buildOnboarding(progress({ goals: true }))!.hasActivity).toBeTrue();
    expect(buildOnboarding(progress({ recurring: true }))!.hasActivity).toBeFalse();
    expect(buildOnboarding(progress({ selah: true }))!.hasActivity).toBeFalse();
  });

  it('tudo feito: 100%, allDone e sem proximo passo', () => {
    const state = buildOnboarding(
      progress({ tasks: true, transactions: true, goals: true, recurring: true, selah: true }),
    )!;

    expect(state.allDone).toBeTrue();
    expect(state.percent).toBe(100);
    expect(state.nextStep).toBeNull();
  });

  it('cada passo leva a uma rota do app', () => {
    const routes = buildOnboarding(progress())!.steps.map((step) => step.route);

    expect(routes).toEqual(['/tasks', '/finances', '/goals', '/finances', '/assistant']);
  });
});
