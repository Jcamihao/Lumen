import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-ui-button',
  standalone: true,
  imports: [CommonModule, NgClass],
  template: `
    <button
      class="ui-button"
      [attr.type]="type"
      [disabled]="disabled"
      [ngClass]="[variant, size, fullWidth ? 'full-width' : '']"
    >
      <span class="material-symbols-rounded" *ngIf="icon">{{ icon }}</span>
      <ng-content></ng-content>
    </button>
  `,
  styles: [`
    :host {
      display: inline-flex;
    }

    .ui-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.55rem;
      min-height: 2.9rem;
      padding: 0.82rem 1.15rem;
      border-radius: var(--radius-pill);
      border: 1px solid transparent;
      font-size: 0.94rem;
      font-weight: 600;
      cursor: pointer;
      transition:
        transform var(--transition-fast),
        box-shadow var(--transition-fast),
        background-color var(--transition-fast),
        border-color var(--transition-fast),
        color var(--transition-fast),
        opacity var(--transition-fast);
      min-width: 0;
      text-align: center;
      line-height: 1.2;
    }

    .ui-button:hover:not(:disabled) {
      transform: translateY(-1px);
    }

    .ui-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .ui-button.primary {
      background: linear-gradient(135deg, var(--accent), var(--accent-hover));
      color: #ffffff;
      box-shadow: 0 14px 28px rgba(99, 102, 241, 0.24);
    }

    .ui-button.primary:hover:not(:disabled) {
      box-shadow: 0 18px 34px rgba(99, 102, 241, 0.28);
    }

    .ui-button.secondary {
      background: var(--card);
      color: var(--text-primary);
      border-color: var(--border);
      box-shadow: var(--shadow-soft);
    }

    .ui-button.ghost {
      background: transparent;
      color: var(--text-medium);
      border-color: var(--border);
    }

    .ui-button.sm {
      min-height: 2.5rem;
      padding: 0.65rem 0.95rem;
      font-size: 0.88rem;
    }

    .ui-button.full-width {
      width: 100%;
    }

    .material-symbols-rounded {
      font-size: 1.15rem;
    }

    @media (max-width: 480px) {
      .ui-button {
        padding-inline: 0.95rem;
      }
    }
  `],
})
export class UiButtonComponent {
  @Input() variant: 'primary' | 'secondary' | 'ghost' = 'primary';
  @Input() size: 'sm' | 'md' = 'md';
  @Input() type: 'button' | 'submit' = 'button';
  @Input() icon = '';
  @Input() disabled = false;
  @Input() fullWidth = false;
}
