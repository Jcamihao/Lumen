import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ImportPreview } from '../../core/models/domain.models';
import { LifeApiService } from '../../core/services/life-api.service';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { ListItemComponent } from '../../shared/components/list-item.component';
import { PanelComponent } from '../../shared/components/panel.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge.component';
import { UiButtonComponent } from '../../shared/components/ui-button.component';

@Component({
  selector: 'app-imports-page',
  standalone: true,
  imports: [CommonModule, PanelComponent, EmptyStateComponent, UiButtonComponent, UiBadgeComponent, ListItemComponent],
  template: `
    <div class="page-stack">
      <section class="split-layout imports-layout">
        <app-panel title="Importar CSV" caption="Preview com deduplicação antes de gravar">
          <div class="upload-card">
            <span class="material-symbols-rounded">upload_file</span>
            <strong>Envie seu extrato em CSV</strong>
            <p>O LUMEN identifica duplicidades antes de confirmar a importação.</p>
            <input #fileInput type="file" accept=".csv,text/csv" hidden (change)="handleFile($event)">
            <app-ui-button icon="upload" (click)="fileInput.click()">
              Selecionar arquivo
            </app-ui-button>
          </div>

          <div class="preview-badges" *ngIf="preview()">
            <app-ui-badge [label]="preview()!.totalRows + ' linhas'" tone="accent" />
            <app-ui-badge [label]="preview()!.duplicates + ' duplicadas'" [tone]="preview()!.duplicates ? 'warning' : 'success'" />
          </div>

          <app-ui-button
            *ngIf="preview()"
            variant="secondary"
            icon="done_all"
            [fullWidth]="true"
            (click)="commitImport()"
          >
            Confirmar importação
          </app-ui-button>
        </app-panel>

        <app-panel title="Preview" caption="Linhas identificadas antes da gravação">
          <div *ngIf="preview(); else noPreview">
            <div class="preview-meta">
              <strong>{{ preview()!.fileName }}</strong>
              <p>{{ preview()!.duplicates }} duplicada(s) em {{ preview()!.totalRows }} linha(s)</p>
            </div>

            <div class="stack-list">
              <app-list-item
                *ngFor="let row of preview()!.rows"
                [title]="row.description"
                [subtitle]="row.type + ' · ' + row.date"
                [meta]="previewAmount(row.amount)"
                [metaTone]="row.type === 'INCOME' ? 'positive' : 'negative'"
                [badge]="row.duplicate ? 'Duplicada' : 'Nova'"
                [badgeTone]="row.duplicate ? 'warning' : 'success'"
                icon="receipt_long"
              />
            </div>
          </div>

          <ng-template #noPreview>
            <app-empty-state
              title="Nenhum arquivo carregado"
              description="Envie um CSV para ver o preview inteligente antes de importar."
              icon="table_chart"
            />
          </ng-template>
        </app-panel>
      </section>
    </div>
  `,
  styles: [`
    .upload-card,
    .stack-list {
      display: grid;
      gap: 1rem;
    }

    .upload-card {
      place-items: center;
      text-align: center;
      padding: 1.4rem;
      border-radius: var(--radius-lg);
      border: 1px dashed var(--border);
      background: var(--card-muted);
    }

    .upload-card .material-symbols-rounded {
      font-size: 2rem;
      color: var(--accent);
    }

    .upload-card p,
    .preview-meta p {
      margin: 0;
      color: var(--text-medium);
    }

    .preview-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.7rem;
      margin: 1rem 0;
    }

    .preview-meta {
      display: grid;
      gap: 0.25rem;
      margin-bottom: 1rem;
    }

    @media (max-width: 520px) {
      .upload-card {
        padding: 1.1rem;
      }
    }

    @media (min-width: 860px) {
      .imports-layout {
        grid-template-columns: 360px minmax(0, 1fr);
      }
    }
  `],
})
export class ImportsPageComponent {
  private readonly api = inject(LifeApiService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly preview = signal<ImportPreview | null>(null);

  protected handleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);

    if (!file) {
      return;
    }

    this.api
      .previewImport(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((preview) => this.preview.set(preview));
  }

  protected commitImport() {
    const preview = this.preview();

    if (!preview) {
      return;
    }

    this.api
      .commitImport(preview.importJobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.preview.set(null));
  }

  protected previewAmount(amount: number) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(amount);
  }
}
