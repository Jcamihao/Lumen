import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Task } from '../../../core/models/domain.models';
import { AuthService } from '../../../core/services/auth.service';
import { focusField } from '../../../core/utils/focus.utils';
import { LifeApiService } from '../../../core/services/life-api.service';
import { dayOnlyParts, formatDayLabel, todayLocalInputValue } from '../../../core/utils/date.utils';
import { ToastService } from '../../../core/services/toast.service';

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

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
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  protected readonly tasks = signal<Task[]>([]);
  protected readonly creatingTask = signal(false);
  protected readonly savingEdit = signal(false);
  protected readonly busyTaskId = signal<string | null>(null);
  protected readonly taskCategories = computed(
    () => this.authService.currentUser()?.taskCategories ?? [],
  );
  protected readonly currencyCode = computed(
    () => this.authService.currentUser()?.preferredCurrency ?? 'BRL',
  );

  // --- Filters ---
  protected readonly filterSearch = signal('');
  protected readonly filterStatus = signal<'' | TaskStatus>('');
  protected readonly filterPriority = signal<'' | TaskPriority>('');
  protected readonly filterCategory = signal('');

  protected readonly filteredTasks = computed(() => {
    const search = this.filterSearch().toLowerCase().trim();
    const status = this.filterStatus();
    const priority = this.filterPriority();
    const category = this.filterCategory();

    return this.tasks().filter((task) => {
      if (status && task.status !== status) return false;
      if (priority && task.priority !== priority) return false;
      if (category && task.category?.id !== category) return false;
      if (search) {
        const haystack = `${task.title} ${task.description ?? ''} ${task.category?.name ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  });

  protected readonly hasActiveFilters = computed(
    () => !!(this.filterSearch() || this.filterStatus() || this.filterPriority() || this.filterCategory()),
  );

  protected readonly groupedFilteredTasks = computed(() => {
    const today = todayLocalInputValue();
    const in7Days = this.addDaysToLocalDay(today, 7);

    const groups: { label: string; tasks: Task[] }[] = [
      { label: 'Atrasadas', tasks: [] },
      { label: 'Hoje', tasks: [] },
      { label: 'Próximos 7 dias', tasks: [] },
      { label: 'Mais adiante', tasks: [] },
      { label: 'Concluídas', tasks: [] },
    ];
    const [overdue, dueToday, dueSoon, later, done] = groups;

    for (const task of this.filteredTasks()) {
      if (task.status === 'DONE') {
        done.tasks.push(task);
        continue;
      }

      const day = this.dueDateLocalDay(task);
      if (day !== null && day < today) {
        overdue.tasks.push(task);
      } else if (day === today) {
        dueToday.tasks.push(task);
      } else if (day !== null && day <= in7Days) {
        dueSoon.tasks.push(task);
      } else {
        later.tasks.push(task);
      }
    }

    return groups.filter((group) => group.tasks.length > 0);
  });

  // --- Aggregates (over ALL tasks, not filtered) ---
  protected readonly activeTasks = computed(
    () => this.tasks().filter((task) => task.status !== 'DONE'),
  );
  protected readonly completedTasks = computed(
    () => this.tasks().filter((task) => task.status === 'DONE'),
  );
  protected readonly highPriorityCount = computed(
    () => this.activeTasks().filter((task) => task.priority === 'HIGH' || task.priority === 'CRITICAL').length,
  );
  protected readonly bestActiveStreak = computed(
    () => this.activeTasks().reduce((max, task) => Math.max(max, task.streakCount), 0),
  );

  // --- Create form ---
  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    dueDate: [''],
    dueTime: [''],
    priority: ['MEDIUM'],
    categoryId: [''],
    isRecurring: [false],
    recurrenceRule: ['daily'],
    hasReminder: [false],
    reminderOffsetMinutes: [30],
  });

  // --- Edit form ---
  protected readonly editingTask = signal<Task | null>(null);
  protected readonly editForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    dueDate: [''],
    priority: ['MEDIUM'],
    categoryId: [''],
    status: ['PENDING'],
    isRecurring: [false],
    recurrenceRule: [''],
  });

  constructor() {
    this.reload();

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const search = params.get('search')?.trim();
        if (search) {
          this.filterSearch.set(search);
        }
      });
  }

  protected focusNewTask() {
    focusField('task-title');
  }

  protected clearFilters() {
    this.filterSearch.set('');
    this.filterStatus.set('');
    this.filterPriority.set('');
    this.filterCategory.set('');
  }

  protected reminderMissingSchedule(): boolean {
    const raw = this.form.getRawValue();
    return raw.hasReminder && (!raw.dueDate || !raw.dueTime);
  }

  protected createTask() {
    if (this.creatingTask()) return;

    if (this.reminderMissingSchedule()) {
      this.toast.error('Pra usar lembrete, defina data e horário do prazo.');
      return;
    }

    const raw = this.form.getRawValue();
    const dueDateIso = raw.dueDate
      ? raw.dueTime
        ? `${raw.dueDate}T${raw.dueTime}:00`
        : raw.dueDate
      : undefined;

    this.creatingTask.set(true);
    this.api
      .createTask({
        title: raw.title,
        description: raw.description || undefined,
        dueDate: dueDateIso,
        priority: raw.priority,
        categoryId: raw.categoryId || undefined,
        isRecurring: raw.isRecurring,
        recurrenceRule: raw.isRecurring ? raw.recurrenceRule : undefined,
      })
      .pipe(
        finalize(() => this.creatingTask.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (task) => {
          if (raw.hasReminder && dueDateIso && raw.dueTime) {
            const remindAt = new Date(
              new Date(dueDateIso).getTime() - raw.reminderOffsetMinutes * 60_000,
            ).toISOString();

            this.api
              .createReminder({ title: `Lembrete: ${raw.title}`, remindAt, taskId: task.id })
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                error: () => this.toast.error('Tarefa criada, mas o lembrete não foi salvo.'),
              });
          }

          this.form.reset({
            title: '',
            description: '',
            dueDate: '',
            dueTime: '',
            priority: 'MEDIUM',
            categoryId: '',
            isRecurring: false,
            recurrenceRule: 'daily',
            hasReminder: false,
            reminderOffsetMinutes: 30,
          });
          this.upsertTask(task);
          this.toast.success('Tarefa criada.');
        },
        error: () => this.toast.error('Não foi possível criar a tarefa.'),
      });
  }

  protected startEdit(task: Task) {
    this.editingTask.set(task);
    this.editForm.reset({
      title: task.title,
      description: task.description ?? '',
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      priority: task.priority,
      categoryId: task.category?.id ?? '',
      status: task.status,
      isRecurring: task.isRecurring,
      recurrenceRule: task.recurrenceRule ?? '',
    });
  }

  protected cancelEdit() {
    this.editingTask.set(null);
  }

  protected saveEdit() {
    const task = this.editingTask();
    if (!task || this.savingEdit()) return;

    const raw = this.editForm.getRawValue();
    this.savingEdit.set(true);
    this.api
      .updateTask(task.id, {
        title: raw.title,
        description: raw.description || undefined,
        dueDate: raw.dueDate || null,
        priority: raw.priority,
        categoryId: raw.categoryId || null,
        status: raw.status,
        isRecurring: raw.isRecurring,
        recurrenceRule: raw.recurrenceRule || null,
      })
      .pipe(
        finalize(() => this.savingEdit.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updatedTask) => {
          this.upsertTask(updatedTask);
          this.editingTask.set(null);
          this.toast.success('Tarefa atualizada.');
        },
        error: () => this.toast.error('Não foi possível atualizar a tarefa.'),
      });
  }

  protected isEditing(task: Task) {
    return this.editingTask()?.id === task.id;
  }

  protected toggleSubtask(task: Task, subtaskIndex: number) {
    const updatedSubtasks = task.subtasks.map((sub, i) =>
      i === subtaskIndex ? { title: sub.title, isCompleted: !sub.isCompleted } : { title: sub.title, isCompleted: sub.isCompleted },
    );

    this.api
      .updateTask(task.id, { subtasks: updatedSubtasks })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updatedTask) => this.upsertTask(updatedTask),
        error: () => this.toast.error('Não foi possível atualizar a subtarefa.'),
      });
  }

  protected subtaskProgress(task: Task) {
    if (!task.subtasks.length) return null;
    const done = task.subtasks.filter((s) => s.isCompleted).length;
    return `${done}/${task.subtasks.length}`;
  }

  protected markDone(task: Task) {
    if (this.busyTaskId()) return;

    this.busyTaskId.set(task.id);
    this.api
      .updateTask(task.id, { status: 'DONE' })
      .pipe(
        finalize(() => this.busyTaskId.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updatedTask) => {
          this.upsertTask(updatedTask);
          this.toast.success('Tarefa concluída.');
        },
        error: () => this.toast.error('Não foi possível atualizar a tarefa.'),
      });
  }

  protected removeTask(id: string) {
    if (!globalThis.confirm('Deseja excluir esta tarefa? Essa ação não pode ser desfeita.')) {
      return;
    }

    this.api
      .deleteTask(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.tasks.update((current) => current.filter((task) => task.id !== id));
          this.toast.success('Tarefa removida.');
        },
        error: () => this.toast.error('Não foi possível remover a tarefa.'),
      });
  }

  protected priorityLabel(priority: Task['priority']) {
    return { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' }[priority];
  }

  protected priorityTone(priority: Task['priority']) {
    return { LOW: 'neutral', MEDIUM: 'accent', HIGH: 'warning', CRITICAL: 'danger' }[priority] as 'neutral' | 'accent' | 'warning' | 'danger';
  }

  protected taskStatusTone(task: Task) {
    if (task.status === 'DONE') return 'success';
    if (this.isOverdue(task)) return 'danger';
    return this.priorityTone(task.priority);
  }

  protected isOverdue(task: Task): boolean {
    if (task.status === 'DONE') return false;
    const day = this.dueDateLocalDay(task);
    return day !== null && day < todayLocalInputValue();
  }

  private dueDateLocalDay(task: Task): string | null {
    if (!task.dueDate) return null;

    const parts = dayOnlyParts(task.dueDate);
    if (parts) {
      return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    }

    const date = new Date(task.dueDate);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addDaysToLocalDay(day: string, amount: number): string {
    const [year, month, date] = day.split('-').map(Number);
    const result = new Date(year, month - 1, date + amount);
    const y = result.getFullYear();
    const m = `${result.getMonth() + 1}`.padStart(2, '0');
    const d = `${result.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  protected taskStatusLabel(status: Task['status']) {
    return { PENDING: 'Pendente', IN_PROGRESS: 'Em andamento', DONE: 'Concluída', CANCELLED: 'Cancelada' }[status];
  }

  protected recurrenceLabel(rule?: string | null) {
    const map: Record<string, string> = {
      daily: 'Diária', weekly: 'Semanal', biweekly: 'Quinzenal',
      monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual',
    };
    return map[rule ?? ''] ?? 'Recorrente';
  }

  protected taskDeadlineLabel(task: Task) {
    return formatDayLabel(task.dueDate, { day: '2-digit', month: 'short' });
  }

  private reload() {
    this.api
      .listTasks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tasks) => this.tasks.set(tasks));
  }

  private upsertTask(task: Task | null) {
    if (!task) return;

    this.tasks.update((current) => {
      const existingIndex = current.findIndex((item) => item.id === task.id);
      if (existingIndex === -1) return this.sortTasks([task, ...current]);
      const next = [...current];
      next[existingIndex] = task;
      return this.sortTasks(next);
    });
  }

  private sortTasks(tasks: Task[]) {
    return [...tasks].sort((left, right) => {
      const leftDue = left.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDue = right.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDue - rightDue;
    });
  }
}
