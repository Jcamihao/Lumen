import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Goal, GoalContribution } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatDayLabel } from '../../../core/utils/date.utils';
import { focusField } from '../../../core/utils/focus.utils';
import { readPlanLimitAction, readPlanLimitMessage } from '../../../core/utils/plan-limit.utils';

@Component({
    selector: 'app-goals-page',
    imports: [CommonModule, ReactiveFormsModule, RouterLink],
    templateUrl: './goals-page.component.html',
    styleUrls: ['./goals-page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class GoalsPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly goals = signal<Goal[]>([]);
  protected readonly creatingGoal = signal(false);
  protected readonly busyGoalId = signal<string | null>(null);
  protected readonly currencyCode = computed(
    () => this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );
  protected readonly savedTotal = computed(
    () => this.goals().reduce((total, goal) => total + goal.currentAmount, 0),
  );
  protected readonly completedGoals = computed(
    () => this.goals().filter((goal) => this.progress(goal) >= 100).length,
  );
  // Meta sem alvo nao tem "%": fica fora da media (senao puxaria pra baixo injustamente).
  protected readonly averageProgress = computed(() => {
    const withTarget = this.goals().filter((goal) => goal.targetAmount !== null);
    if (!withTarget.length) return 0;
    return Math.round(
      withTarget.reduce((total, goal) => total + this.progress(goal), 0) / withTarget.length,
    );
  });

  // Contributions panel
  protected readonly expandedContribGoalId = signal<string | null>(null);
  protected readonly goalContributions = signal<Record<string, GoalContribution[]>>({});
  protected readonly loadingContribGoalId = signal<string | null>(null);

  // Custom contribute panel
  protected readonly contributeGoalId = signal<string | null>(null);
  protected readonly contributeAmount = signal(0);
  protected readonly withdrawGoalId = signal<string | null>(null);
  protected readonly withdrawAmount = signal(0);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    /** Vazio = meta sem valor-alvo (cofrinho sem propósito, ex.: reserva de emergência). */
    targetAmount: [null as number | null, [Validators.min(1)]],
    currentAmount: [0],
    targetDate: [''],
    recurringEnabled: [false],
    recurringAmount: [200, [Validators.min(1)]],
    recurringDay: [5, [Validators.min(1), Validators.max(28)]],
  });

  // Edicao de aporte automatico numa meta ja existente
  protected readonly recurringEditGoalId = signal<string | null>(null);
  protected readonly recurringDraftAmount = signal(200);
  protected readonly recurringDraftDay = signal(5);

  protected focusNewGoal() {
    focusField('goal-title');
  }

  constructor() {
    this.reload();
  }

  protected toggleContributions(goalId: string) {
    if (this.expandedContribGoalId() === goalId) {
      this.expandedContribGoalId.set(null);
      return;
    }

    this.expandedContribGoalId.set(goalId);

    if (this.goalContributions()[goalId]) {
      return;
    }

    this.loadingContribGoalId.set(goalId);
    this.api
      .listGoalContributions(goalId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (contributions) => {
          this.goalContributions.update((map) => ({ ...map, [goalId]: contributions }));
          this.loadingContribGoalId.set(null);
        },
        error: () => {
          this.loadingContribGoalId.set(null);
          this.toast.error('Não foi possível carregar o histórico de aportes.');
        },
      });
  }

  protected contributionsOf(goalId: string): GoalContribution[] {
    return this.goalContributions()[goalId] ?? [];
  }

  protected isContribExpanded(goalId: string) {
    return this.expandedContribGoalId() === goalId;
  }

  protected openCustomContribute(goalId: string) {
    this.contributeGoalId.set(goalId);
    this.contributeAmount.set(0);
    this.withdrawGoalId.set(null);
  }

  protected cancelCustomContribute() {
    this.contributeGoalId.set(null);
  }

  protected isContributing(goalId: string) {
    return this.contributeGoalId() === goalId;
  }

  protected openWithdraw(goalId: string) {
    this.withdrawGoalId.set(goalId);
    this.withdrawAmount.set(0);
    this.contributeGoalId.set(null);
  }

  protected cancelWithdraw() {
    this.withdrawGoalId.set(null);
  }

  protected isWithdrawing(goalId: string) {
    return this.withdrawGoalId() === goalId;
  }

  protected createGoal() {
    if (this.creatingGoal()) return;

    const raw = this.form.getRawValue();
    this.creatingGoal.set(true);
    this.api
      .createGoal({
        title: raw.title,
        description: raw.description || undefined,
        targetAmount: raw.targetAmount ?? undefined,
        currentAmount: raw.currentAmount || 0,
        targetDate: raw.targetDate || undefined,
        recurringAmount: raw.recurringEnabled ? raw.recurringAmount : undefined,
        recurringDay: raw.recurringEnabled ? raw.recurringDay : undefined,
      })
      .pipe(
        finalize(() => this.creatingGoal.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (goal) => {
          this.form.reset({
            title: '',
            description: '',
            targetAmount: null,
            currentAmount: 0,
            targetDate: '',
            recurringEnabled: false,
            recurringAmount: 200,
            recurringDay: 5,
          });
          this.upsertGoal(goal);
          this.toast.success('Meta criada.');
        },
        error: (error) => {
          const message = readPlanLimitMessage(error) ?? 'Não foi possível criar a meta.';
          const action = readPlanLimitAction(error);
          if (action) {
            this.toast.errorWithAction(message, action);
          } else {
            this.toast.error(message);
          }
        },
      });
  }

  protected hasRecurring(goal: Goal) {
    return !!goal.recurringAmount && !!goal.recurringDay;
  }

  protected recurringLabel(goal: Goal) {
    if (!this.hasRecurring(goal)) return 'Sem aporte automático configurado';
    const amount = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: this.currencyCode(),
    }).format(goal.recurringAmount!);
    return `${amount} todo dia ${goal.recurringDay} do mês`;
  }

  protected isEditingRecurring(goalId: string) {
    return this.recurringEditGoalId() === goalId;
  }

  protected openRecurringEdit(goal: Goal) {
    this.recurringEditGoalId.set(goal.id);
    this.recurringDraftAmount.set(goal.recurringAmount || 200);
    this.recurringDraftDay.set(goal.recurringDay || 5);
  }

  protected cancelRecurringEdit() {
    this.recurringEditGoalId.set(null);
  }

  protected saveRecurring(goal: Goal) {
    const amount = this.recurringDraftAmount();
    const day = this.recurringDraftDay();
    if (!amount || amount <= 0) {
      this.toast.error('Informe um valor válido para o aporte automático.');
      return;
    }
    if (!day || day < 1 || day > 28) {
      this.toast.error('Escolha um dia entre 1 e 28.');
      return;
    }

    this.api
      .updateGoal(goal.id, { recurringAmount: amount, recurringDay: day })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updatedGoal) => {
          this.upsertGoal(updatedGoal);
          this.recurringEditGoalId.set(null);
          this.toast.success('Aporte automático configurado.');
        },
        error: () => this.toast.error('Não foi possível salvar o aporte automático.'),
      });
  }

  protected removeRecurring(goal: Goal) {
    this.api
      .updateGoal(goal.id, { recurringAmount: null, recurringDay: null })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updatedGoal) => {
          this.upsertGoal(updatedGoal);
          this.recurringEditGoalId.set(null);
          this.toast.success('Aporte automático removido.');
        },
        error: () => this.toast.error('Não foi possível remover o aporte automático.'),
      });
  }

  protected contribute(goal: Goal, amount: number) {
    if (this.busyGoalId()) return;

    this.busyGoalId.set(goal.id);
    this.api
      .contributeGoal(goal.id, { amount })
      .pipe(
        finalize(() => this.busyGoalId.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updatedGoal) => {
          this.upsertGoal(updatedGoal);
          this.goalContributions.update((map) => {
            const { [goal.id]: _removed, ...rest } = map;
            return rest;
          });
          this.contributeGoalId.set(null);
          this.toast.success('Aporte registrado.');
        },
        error: () => this.toast.error('Não foi possível registrar o aporte.'),
      });
  }

  protected contributeCustom(goal: Goal) {
    const amount = this.contributeAmount();
    if (!amount || amount <= 0) {
      this.toast.error('Informe um valor válido para o aporte.');
      return;
    }
    this.contribute(goal, amount);
  }

  protected withdrawCustom(goal: Goal) {
    this.withdraw(goal, this.withdrawAmount());
  }

  protected withdraw(goal: Goal, amount: number) {
    if (!amount || amount <= 0) {
      this.toast.error('Informe um valor válido para o saque.');
      return;
    }

    if (amount > goal.currentAmount) {
      this.toast.error('Esse valor é maior do que o saldo guardado nesta meta.');
      return;
    }

    if (this.busyGoalId()) return;

    this.busyGoalId.set(goal.id);
    this.api
      .withdrawGoal(goal.id, { amount })
      .pipe(
        finalize(() => this.busyGoalId.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updatedGoal) => {
          this.upsertGoal(updatedGoal);
          this.goalContributions.update((map) => {
            const { [goal.id]: _removed, ...rest } = map;
            return rest;
          });
          this.withdrawGoalId.set(null);
          this.toast.success('Saque registrado.');
        },
        error: (error) =>
          this.toast.error(this.errorMessage(error, 'Não foi possível registrar o saque.')),
      });
  }

  protected removeGoal(id: string) {
    if (!globalThis.confirm('Deseja excluir esta meta? Essa ação não pode ser desfeita.')) return;

    this.api
      .deleteGoal(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.goals.update((current) => current.filter((goal) => goal.id !== id));
          this.toast.success('Meta removida.');
        },
        error: () => this.toast.error('Não foi possível remover a meta.'),
      });
  }

  /** Meta sem alvo (cofrinho sem propósito) não tem "%": a tela esconde a barra nesse caso. */
  protected progress(goal: Goal) {
    if (goal.targetAmount === null) return 0;
    return Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100);
  }

  protected remainingAmount(goal: Goal) {
    if (goal.targetAmount === null) return 0;
    return Math.max(goal.targetAmount - goal.currentAmount, 0);
  }

  protected goalStatus(goal: Goal) {
    if (goal.status === 'ACHIEVED' || this.progress(goal) >= 100) return 'Concluída';
    if (goal.status === 'PAUSED') return 'Pausada';
    return 'Ativa';
  }

  protected goalStatusTone(goal: Goal) {
    if (goal.status === 'ACHIEVED' || this.progress(goal) >= 100) return 'success' as const;
    if (goal.status === 'PAUSED') return 'warning' as const;
    return 'accent' as const;
  }

  protected goalProgressTone(goal: Goal) {
    const p = this.progress(goal);
    if (p >= 100) return 'success' as const;
    if (p >= 50) return 'accent' as const;
    return 'warning' as const;
  }

  protected goalDeadlineLabel(goal: Goal) {
    if (!goal.targetDate) return 'Sem prazo definido';
    return `Prazo ${formatDayLabel(goal.targetDate)}`;
  }

  protected contributionDateLabel(date: string) {
    return formatDayLabel(date, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private reload() {
    this.api
      .listGoals()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((goals) => this.goals.set(goals));
  }

  private upsertGoal(goal: Goal | null) {
    if (!goal) return;

    this.goals.update((current) => {
      const existingIndex = current.findIndex((item) => item.id === goal.id);
      if (existingIndex === -1) return this.sortGoals([goal, ...current]);
      const next = [...current];
      next[existingIndex] = goal;
      return this.sortGoals(next);
    });
  }

  private sortGoals(goals: Goal[]) {
    return [...goals].sort((left, right) => {
      const leftAchieved = left.status === 'ACHIEVED' ? 1 : 0;
      const rightAchieved = right.status === 'ACHIEVED' ? 1 : 0;
      if (leftAchieved !== rightAchieved) return leftAchieved - rightAchieved;

      const leftDate = left.targetDate ? new Date(left.targetDate).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDate = right.targetDate ? new Date(right.targetDate).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDate - rightDate;
    });
  }

  private errorMessage(error: any, fallback: string) {
    const message = error?.error?.message;

    if (error?.status === 400 && typeof message === 'string') {
      return message;
    }

    return fallback;
  }
}
