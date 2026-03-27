import { CommonModule, CurrencyPipe, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-metric-card',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, NgClass],
  template: `
    <article class="metric-card" [ngClass]="tone">
      <div class="metric-top">
        <span class="label">{{ label }}</span>
        <span class="pulse"></span>
      </div>
      <div class="metric-body">
        <strong class="value" *ngIf="!currency; else currencyValue">{{ value }}</strong>
        <ng-template #currencyValue>
          <strong class="value">{{ value | currency: currencyCode : 'symbol' : '1.0-0' : 'pt-BR' }}</strong>
        </ng-template>
        <p class="caption">{{ caption }}</p>
      </div>
    </article>
  `,
  styles: [`
    .metric-card {
      padding: 1.2rem;
      border-radius: var(--radius-lg);
      display: grid;
      gap: 0.7rem;
      align-content: start;
      background: var(--card);
      border: 1px solid var(--border);
      box-shadow: var(--shadow-card);
      min-height: 148px;
      transition:
        transform var(--transition-base),
        box-shadow var(--transition-base),
        border-color var(--transition-base);
    }

    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-float);
      border-color: rgba(99, 102, 241, 0.22);
    }

    .metric-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.8rem;
    }

    .metric-body {
      display: grid;
      gap: 0.45rem;
      align-content: start;
    }

    .metric-card.success {
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.08), transparent), var(--card);
    }

    .metric-card.warning {
      background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), transparent), var(--card);
    }

    .metric-card.danger {
      background: linear-gradient(180deg, rgba(239, 68, 68, 0.08), transparent), var(--card);
    }

    .label {
      font-size: 0.76rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--text-secondary);
      font-weight: 700;
    }

    .pulse {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 8px rgba(99, 102, 241, 0.12);
    }

    .value {
      display: block;
      font-family: var(--font-display);
      font-size: clamp(1.4rem, 2vw, 2rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      color: var(--text-primary);
    }

    .caption {
      margin: 0;
      color: var(--text-medium);
      font-size: 0.9rem;
    }

    @media (max-width: 640px) {
      .metric-card {
        min-height: 132px;
        padding: 1rem;
      }
    }
  `],
})
export class MetricCardComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) value!: string | number;
  @Input() caption = '';
  @Input() tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral';
  @Input() currency = false;
  @Input() currencyCode = 'BRL';
}
