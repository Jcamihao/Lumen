import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Task } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { LifeApiService } from '../../../core/services/life-api.service';

@Component({
  selector: 'app-tasks-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './tasks-page.component.html',
  styleUrls: ['./tasks-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  protected readonly activeTasks = computed(
    () => this.tasks().filter((task) => task.status !== 'DONE'),
  );
  protected readonly completedTasks = computed(
    () => this.tasks().filter((task) => task.status === 'DONE'),
  );
  protected readonly doneCount = computed(
    () => this.tasks().filter((task) => task.status === 'DONE').length,
  );
  protected readonly highPriorityCount = computed(
    () =>
      this.activeTasks().filter(
        (task) => task.priority === 'HIGH' || task.priority === 'CRITICAL',
      ).length,
  );
  protected readonly impactCount = computed(
    () => this.tasks().filter((task) => task.hasFinancialImpact).length,
  );
  protected readonly pendingCount = computed(
    () => this.tasks().filter((task) => task.status !== 'DONE').length,
  );
  protected readonly totalImpact = computed(
    () =>
      this.activeTasks().reduce(
        (total, task) => total + Number(task.estimatedAmount || 0),
        0,
      ),
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
      .subscribe((task) => {
        this.form.reset({
          title: '',
          description: '',
          dueDate: '',
          priority: 'MEDIUM',
          categoryId: '',
          estimatedAmount: 0,
        });
        this.upsertTask(task);
      });
  }

  protected markDone(task: Task) {
    this.api
      .updateTask(task.id, {
        status: 'DONE',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updatedTask) => this.upsertTask(updatedTask));
  }

  protected removeTask(id: string) {
    this.api
      .deleteTask(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.tasks.update((current) => current.filter((task) => task.id !== id));
      });
  }

  protected taskSubtitle(task: Task) {
    return task.description || task.category?.name || 'Sem categoria definida';
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

  protected taskStatusTone(task: Task) {
    return task.status === 'DONE' ? 'success' : this.priorityTone(task.priority);
  }

  protected taskCategoryLabel(task: Task) {
    return task.category?.name || 'Sem categoria';
  }

  protected taskDeadlineLabel(task: Task) {
    if (!task.dueDate) {
      return 'Sem prazo';
    }

    return new Date(task.dueDate).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
  }

  private reload() {
    this.api
      .listTasks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tasks) => this.tasks.set(tasks));
  }

  private upsertTask(task: Task | null) {
    if (!task) {
      return;
    }

    this.tasks.update((current) => {
      const existingIndex = current.findIndex((item) => item.id === task.id);

      if (existingIndex === -1) {
        return this.sortTasks([task, ...current]);
      }

      const next = [...current];
      next[existingIndex] = task;
      return this.sortTasks(next);
    });
  }

  private sortTasks(tasks: Task[]) {
    return [...tasks].sort((left, right) => {
      const leftDue = left.dueDate
        ? new Date(left.dueDate).getTime()
        : Number.MAX_SAFE_INTEGER;
      const rightDue = right.dueDate
        ? new Date(right.dueDate).getTime()
        : Number.MAX_SAFE_INTEGER;

      return leftDue - rightDue;
    });
  }
}
