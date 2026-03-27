import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-ui-badge',
  standalone: true,
  imports: [CommonModule, NgClass],
  template: `
    <span class="badge" [ngClass]="tone">
      <span class="dot" *ngIf="showDot"></span>
      {{ label }}
    </span>
  `,
  styles: [`
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.38rem;
      min-height: 1.9rem;
      padding: 0.32rem 0.7rem;
      border-radius: var(--radius-pill);
      border: 1px solid transparent;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .dot {
      width: 0.38rem;
      height: 0.38rem;
      border-radius: 50%;
      background: currentColor;
    }

    .badge.neutral {
      color: var(--text-medium);
      background: var(--card-muted);
      border-color: var(--border);
    }

    .badge.accent {
      color: var(--accent);
      background: rgba(99, 102, 241, 0.1);
      border-color: rgba(99, 102, 241, 0.16);
    }

    .badge.success {
      color: var(--success);
      background: rgba(16, 185, 129, 0.1);
      border-color: rgba(16, 185, 129, 0.16);
    }

    .badge.warning {
      color: var(--warning);
      background: rgba(245, 158, 11, 0.1);
      border-color: rgba(245, 158, 11, 0.16);
    }

    .badge.danger {
      color: var(--danger);
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.16);
    }

    .badge.dark {
      color: #ffffff;
      background: var(--primary-dark);
      border-color: rgba(255, 255, 255, 0.08);
    }

    @media (max-width: 480px) {
      .badge {
        white-space: normal;
        text-align: center;
        justify-content: center;
        line-height: 1.2;
      }
    }
  `],
})
export class UiBadgeComponent {
  @Input({ required: true }) label!: string;
  @Input() tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'dark' = 'neutral';
  @Input() showDot = true;
}
