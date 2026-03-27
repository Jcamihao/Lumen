import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Task } from '../../core/models/domain.models';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { FieldShellComponent } from '../../shared/components/field-shell.component';
import { ListItemComponent } from '../../shared/components/list-item.component';
import { MetricCardComponent } from '../../shared/components/metric-card.component';
import { PanelComponent } from '../../shared/components/panel.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge.component';
import { UiButtonComponent } from '../../shared/components/ui-button.component';

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
  template: `
    <div class="page-stack">
      <section class="metrics">
        <app-metric-card
          label="Tarefas totais"
          [value]="tasks().length"
          caption="Tudo que já entrou no seu fluxo"
        />
        <app-metric-card
          label="Concluídas"
          [value]="doneCount()"
          caption="Itens já resolvidos"
          tone="success"
        />
        <app-metric-card
          label="Com impacto"
          [value]="impactCount()"
          caption="Tarefas com efeito financeiro"
          tone="warning"
        />
      </section>

      <section class="split-layout tasks-layout">
        <app-panel class="composer-panel" title="Nova tarefa" caption="Transforme intenção em ação com contexto">
          <form class="form-grid" [formGroup]="form" (ngSubmit)="createTask()">
            <app-field-shell label="Título" hint="Obrigatório">
              <input type="text" formControlName="title" placeholder="Ex.: Pagar conta de energia">
            </app-field-shell>

            <app-field-shell label="Descrição" hint="Opcional">
              <textarea
                rows="4"
                formControlName="description"
                placeholder="Contexto, detalhe importante ou próximo passo"
              ></textarea>
            </app-field-shell>

            <div class="grid-2">
              <app-field-shell label="Prazo">
                <input type="date" formControlName="dueDate">
              </app-field-shell>

              <app-field-shell label="Prioridade">
                <select formControlName="priority">
                  <option value="MEDIUM">Média</option>
                  <option value="LOW">Baixa</option>
                  <option value="HIGH">Alta</option>
                  <option value="CRITICAL">Crítica</option>
                </select>
              </app-field-shell>
            </div>

            <div class="grid-2">
              <app-field-shell label="Categoria">
                <select formControlName="categoryId">
                  <option value="">Sem categoria</option>
                  <option *ngFor="let category of taskCategories()" [value]="category.id">
                    {{ category.name }}
                  </option>
                </select>
              </app-field-shell>

              <app-field-shell label="Impacto estimado" hint="BRL">
                <input type="number" formControlName="estimatedAmount" placeholder="0">
              </app-field-shell>
            </div>

            <div class="surface-note">
              <app-ui-badge
                [label]="form.value.estimatedAmount ? 'Com impacto financeiro' : 'Tarefa operacional'"
                [tone]="form.value.estimatedAmount ? 'warning' : 'accent'"
              />
            </div>

            <app-ui-button type="submit" [disabled]="form.invalid" [fullWidth]="true" icon="add_task">
              Criar tarefa
            </app-ui-button>
          </form>
        </app-panel>

        <app-panel class="queue-panel" title="Fila atual" caption="Prioridades, ritmo e pontos de atenção">
          <div class="toolbar">
            <app-ui-badge [label]="doneCount() + ' concluídas'" tone="success" />
            <app-ui-badge [label]="pendingCount() + ' abertas'" tone="accent" />
            <app-ui-badge [label]="impactCount() + ' com custo'" tone="warning" />
          </div>

          <div class="stack-list" *ngIf="tasks().length; else noTasks">
            <app-list-item
              *ngFor="let task of tasks()"
              [title]="task.title"
              [subtitle]="taskSubtitle(task)"
              [meta]="taskMeta(task)"
              [metaTone]="task.hasFinancialImpact ? 'warning' : 'neutral'"
              [badge]="priorityLabel(task.priority)"
              [badgeTone]="priorityTone(task.priority)"
              [checkable]="true"
              [checked]="task.status === 'DONE'"
            >
              <div list-actions class="row-actions">
                <app-ui-button
                  variant="secondary"
                  size="sm"
                  [disabled]="task.status === 'DONE'"
                  (click)="markDone(task)"
                >
                  {{ task.status === 'DONE' ? 'Concluída' : 'Concluir' }}
                </app-ui-button>
                <app-ui-button variant="ghost" size="sm" (click)="removeTask(task.id)">
                  Excluir
                </app-ui-button>
              </div>
            </app-list-item>
          </div>

          <ng-template #noTasks>
            <app-empty-state
              title="Nenhuma tarefa por aqui"
              description="Crie sua primeira prioridade conectada ao seu contexto real."
              icon="checklist"
            />
          </ng-template>
        </app-panel>
      </section>
    </div>
  `,
  styles: [`
    .metrics,
    .form-grid,
    .stack-list {
      display: grid;
      gap: 1rem;
    }

    .toolbar,
    .row-actions {
      display: flex;
      gap: 0.65rem;
      flex-wrap: wrap;
    }

    .grid-2 {
      display: grid;
      gap: 0.9rem;
    }

    @media (min-width: 860px) {
      .tasks-layout {
        align-items: start;
      }

      .metrics {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .tasks-layout {
        grid-template-columns: 410px minmax(0, 1fr);
      }

      .grid-2 {
        grid-template-columns: 1fr 1fr;
      }

      .composer-panel {
        position: sticky;
        top: 6.5rem;
      }
    }

    @media (min-width: 1320px) {
      .tasks-layout {
        grid-template-columns: 430px minmax(0, 1fr);
      }
    }

    @media (max-width: 520px) {
      .toolbar {
        flex-wrap: nowrap;
        overflow-x: auto;
        padding-bottom: 0.2rem;
        scrollbar-width: none;
      }

      .toolbar::-webkit-scrollbar {
        display: none;
      }

      .row-actions {
        width: 100%;
      }

      .row-actions app-ui-button {
        flex: 1 1 100%;
      }
    }
  `],
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
