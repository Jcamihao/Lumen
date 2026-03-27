import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-field-shell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <label class="field-shell">
      <span class="field-header">
        <strong>{{ label }}</strong>
        <span *ngIf="hint">{{ hint }}</span>
      </span>
      <ng-content></ng-content>
    </label>
  `,
  styles: [`
    .field-shell {
      display: grid;
      gap: 0.6rem;
    }

    .field-header {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    strong {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    span {
      font-size: 0.82rem;
      color: var(--text-secondary);
    }
  `],
})
export class FieldShellComponent {
  @Input({ required: true }) label!: string;
  @Input() hint = '';
}
