import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Task } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { FieldShellComponent } from '../../../shared/components/field-shell/field-shell.component';
import { ListItemComponent } from '../../../shared/components/list-item/list-item.component';
import { MetricCardComponent } from '../../../shared/components/metric-card/metric-card.component';
import { PanelComponent } from '../../../shared/components/panel/panel.component';
import { UiBadgeComponent } from '../../../shared/components/ui-badge/ui-badge.component';
import { UiButtonComponent } from '../../../shared/components/ui-button/ui-button.component';

@Component({
  selector: 'app-tasks-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DatePipe,
    PanelComponent,
    EmptyStateComponent,
    FieldShellComponent,
    UiButtonComponent,
    UiBadgeComponent,
    ListItemComponent,
    MetricCardComponent,
  ],
  templateUrl: './tasks-page.component.html',
  styleUrls: ['./tasks-page.component.scss'],
})
export class TasksPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly tasks = signal<Task[]>([]);
  protected readonly taskCategories = computed(
    () => this.authService.currentUser()?.taskCategories ?? [],
  );
  protected readonly doneCount = computed(
    () => this.tasks().filter((task) => task.status === 'DONE').length,
  );
  protected readonly impactCount = computed(
    () => this.tasks().filter((task) => task.hasFinancialImpact).length,
  );
  protected readonly pendingCount = computed(
    () => this.tasks().filter((task) => task.status !== 'DONE').length,
  );

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    dueDate: [''],
    priority: ['MEDIUM'],
    categoryId: [''],
    estimatedAmount: [0],
  });

  constructor() {
    this.reload();
  }

  protected createTask() {
    const raw = this.form.getRawValue();
    this.api
      .createTask({
        title: raw.title,
        description: raw.description || undefined,
        dueDate: raw.dueDate || undefined,
        priority: raw.priority,
        categoryId: raw.categoryId || undefined,
        hasFinancialImpact: !!raw.estimatedAmount,
        estimatedAmount: raw.estimatedAmount || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.reset({
          title: '',
          description: '',
          dueDate: '',
          priority: 'MEDIUM',
          categoryId: '',
          estimatedAmount: 0,
        });
        this.reload();
      });
  }

  protected markDone(task: Task) {
    this.api
      .updateTask(task.id, {
        status: 'DONE',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  protected removeTask(id: string) {
    this.api
      .deleteTask(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());
  }

  protected taskSubtitle(task: Task) {
    return task.description || task.category?.name || 'Sem categoria definida';
  }

  protected taskMeta(task: Task) {
    const due = task.dueDate
      ? new Date(task.dueDate).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'short',
        })
      : 'Sem prazo';

    return task.estimatedAmount
      ? `${due} · ${new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          maximumFractionDigits: 0,
        }).format(task.estimatedAmount)}`
      : due;
  }

  protected priorityLabel(priority: Task['priority']) {
    return {
      LOW: 'Baixa',
      MEDIUM: 'Média',
      HIGH: 'Alta',
      CRITICAL: 'Crítica',
    }[priority];
  }

  protected priorityTone(priority: Task['priority']) {
    return {
      LOW: 'neutral',
      MEDIUM: 'accent',
      HIGH: 'warning',
      CRITICAL: 'danger',
    }[priority] as 'neutral' | 'accent' | 'warning' | 'danger';
  }

  private reload() {
    this.api
      .listTasks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tasks) => this.tasks.set(tasks));
  }
}
