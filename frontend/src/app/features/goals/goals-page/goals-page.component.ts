import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Goal } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { FieldShellComponent } from '../../../shared/components/field-shell/field-shell.component';
import { MetricCardComponent } from '../../../shared/components/metric-card/metric-card.component';
import { PanelComponent } from '../../../shared/components/panel/panel.component';
import { UiBadgeComponent } from '../../../shared/components/ui-badge/ui-badge.component';
import { UiButtonComponent } from '../../../shared/components/ui-button/ui-button.component';

@Component({
  selector: 'app-goals-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CurrencyPipe,
    DatePipe,
    PanelComponent,
    EmptyStateComponent,
    FieldShellComponent,
    UiButtonComponent,
    UiBadgeComponent,
    MetricCardComponent,
  ],
  templateUrl: './goals-page.component.html',
  styleUrls: ['./goals-page.component.scss'],
})
export class GoalsPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly goals = signal<Goal[]>([]);
  protected readonly currencyCode = signal(
    this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );
  protected readonly savedTotal = computed(
    () => this.goals().reduce((total, goal) => total + goal.currentAmount, 0),
  );
  protected readonly averageProgress = computed(() => {
    if (!this.goals().length) {
      return 0;
    }

    return Math.round(
      this.goals().reduce((total, goal) => total + this.progress(goal), 0) / this.goals().length,
    );
  });

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    targetAmount: [12000, [Validators.required, Validators.min(1)]],
    currentAmount: [0],
    targetDate: [''],
  });

  constructor() {
    this.reload();
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
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.reset({
          title: '',
          description: '',
          targetAmount: 12000,
          currentAmount: 0,
          targetDate: '',
        });
        this.reload();
      });
  }

  protected contribute(goal: Goal, amount: number) {
    this.api
      .contributeGoal(goal.id, { amount })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  protected removeGoal(id: string) {
    this.api
      .deleteGoal(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  protected progress(goal: Goal) {
    return Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100);
  }

  protected remainingAmount(goal: Goal) {
    return Math.max(goal.targetAmount - goal.currentAmount, 0);
  }

  protected goalDeadlineLabel(goal: Goal) {
    if (!goal.targetDate) {
      return 'Sem prazo definido';
    }

    return `Prazo ${new Intl.DateTimeFormat('pt-BR').format(new Date(goal.targetDate))}`;
  }

  private reload() {
    this.api
      .listGoals()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((goals) => this.goals.set(goals));
  }
}
