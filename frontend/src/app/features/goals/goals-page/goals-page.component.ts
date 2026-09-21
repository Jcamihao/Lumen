import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Goal, GoalContribution } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { focusField } from '../../../core/utils/focus.utils';

@Component({
  selector: 'app-goals-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './goals-page.component.html',
  styleUrls: ['./goals-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoalsPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly goals = signal<Goal[]>([]);
  protected readonly currencyCode = computed(
    () => this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );
  protected readonly savedTotal = computed(
    () => this.goals().reduce((total, goal) => total + goal.currentAmount, 0),
  );
  protected readonly completedGoals = computed(
    () => this.goals().filter((goal) => this.progress(goal) >= 100).length,
  );
  protected readonly averageProgress = computed(() => {
    if (!this.goals().length) return 0;
    return Math.round(
      this.goals().reduce((total, goal) => total + this.progress(goal), 0) / this.goals().length,
    );
  });

  // Contributions panel
  protected readonly expandedContribGoalId = signal<string | null>(null);
  protected readonly goalContributions = signal<Record<string, GoalContribution[]>>({});
  protected readonly loadingContribGoalId = signal<string | null>(null);

  // Custom contribute panel
  protected readonly contributeGoalId = signal<string | null>(null);
  protected readonly contributeAmount = signal(0);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    targetAmount: [12000, [Validators.required, Validators.min(1)]],
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
  }

  protected cancelCustomContribute() {
    this.contributeGoalId.set(null);
  }

  protected isContributing(goalId: string) {
    return this.contributeGoalId() === goalId;
  }

  protected createGoal() {
    const raw = this.form.getRawValue();
    this.api
      .createGoal({
        title: raw.title,
        description: raw.description || undefined,
        targetAmount: raw.targetAmount,
        currentAmount: raw.currentAmount || 0,
        targetDate: raw.targetDate || undefined,
        recurringAmount: raw.recurringEnabled ? raw.recurringAmount : undefined,
        recurringDay: raw.recurringEnabled ? raw.recurringDay : undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (goal) => {
          this.form.reset({
            title: '',
            description: '',
            targetAmount: 12000,
            currentAmount: 0,
            targetDate: '',
            recurringEnabled: false,
            recurringAmount: 200,
            recurringDay: 5,
          });
          this.upsertGoal(goal);
          this.toast.success('Meta criada.');
        },
        error: () => this.toast.error('Não foi possível criar a meta.'),
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
    this.api
      .contributeGoal(goal.id, { amount })
      .pipe(takeUntilDestroyed(this.destroyRef))
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

  protected progress(goal: Goal) {
    return Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100);
  }

  protected remainingAmount(goal: Goal) {
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
    return `Prazo ${new Intl.DateTimeFormat('pt-BR').format(new Date(goal.targetDate))}`;
  }

  protected contributionDateLabel(date: string) {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
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
}
