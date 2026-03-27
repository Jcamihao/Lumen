import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PanelComponent } from './panel.component';
import { UiBadgeComponent } from './ui-badge.component';

@Component({
  selector: 'app-chart-card',
  standalone: true,
  imports: [CommonModule, PanelComponent, UiBadgeComponent],
  template: `
    <app-panel [title]="title" [caption]="caption">
      <div class="chart-header">
        <div class="value-stack">
          <strong>{{ value }}</strong>
          <span>{{ helper }}</span>
        </div>
        <app-ui-badge
          *ngIf="delta"
          [label]="delta"
          [tone]="deltaTone"
          [showDot]="false"
        />
      </div>

      <div class="chart-shell">
        <svg viewBox="0 0 320 172" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(99, 102, 241, 0.28)"></stop>
              <stop offset="100%" stop-color="rgba(99, 102, 241, 0.02)"></stop>
            </linearGradient>
          </defs>
          <line class="guide" x1="0" y1="44" x2="320" y2="44"></line>
          <line class="guide" x1="0" y1="92" x2="320" y2="92"></line>
          <line class="guide" x1="0" y1="140" x2="320" y2="140"></line>
          <path class="area" [attr.d]="areaPath()" [attr.fill]="'url(#' + gradientId + ')'"></path>
          <path class="line-shadow" [attr.d]="linePath()"></path>
          <path class="line" [attr.d]="linePath()"></path>
          <circle
            *ngFor="let point of points(); trackBy: trackPoint"
            class="point"
            [attr.cx]="point.x"
            [attr.cy]="point.y"
            r="3.5"
          ></circle>
        </svg>
      </div>

      <div class="chart-labels">
        <span *ngFor="let label of safeLabels(); trackBy: trackLabel">{{ label }}</span>
      </div>
    </app-panel>
  `,
  styles: [`
    .chart-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.2rem;
    }

    .value-stack {
      display: grid;
      gap: 0.28rem;
    }

    .value-stack strong {
      font-size: clamp(1.5rem, 2.4vw, 2.1rem);
      line-height: 1.1;
      color: var(--text-primary);
    }

    .value-stack span {
      color: var(--text-medium);
      font-size: 0.92rem;
    }

    .chart-shell {
      border-radius: var(--radius-lg);
      background:
        linear-gradient(180deg, rgba(99, 102, 241, 0.07), transparent 55%),
        var(--card-muted);
      border: 1px solid var(--border);
      padding: 0.85rem;
    }

    svg {
      width: 100%;
      height: 172px;
      overflow: visible;
    }

    .guide {
      stroke: var(--border);
      stroke-width: 1;
      stroke-dasharray: 3 5;
      opacity: 0.8;
    }

    .line-shadow {
      fill: none;
      stroke: rgba(17, 17, 17, 0.08);
      stroke-width: 7;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .line {
      fill: none;
      stroke: var(--accent);
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .point {
      fill: var(--card);
      stroke: var(--accent);
      stroke-width: 3;
    }

    .chart-labels {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 0.5rem;
      margin-top: 0.85rem;
      color: var(--text-secondary);
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    @media (max-width: 640px) {
      .chart-header {
        display: grid;
      }

      .chart-shell {
        padding: 0.7rem;
      }

      svg {
        height: 154px;
      }

      .chart-labels {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        row-gap: 0.35rem;
      }
    }
  `],
})
export class ChartCardComponent {
  private readonly fallbackSeries = [42, 48, 44, 56, 61, 58];
  protected readonly gradientId = `chart-${Math.random().toString(36).slice(2, 10)}`;

  @Input({ required: true }) title!: string;
  @Input() caption = '';
  @Input() value = '';
  @Input() helper = '';
  @Input() delta = '';
  @Input() deltaTone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'dark' = 'accent';
  @Input() data: number[] = [];
  @Input() labels: string[] = [];

  protected points() {
    const series = this.safeSeries();
    const width = 320;
    const height = 140;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;

    return series.map((value, index) => ({
      x: series.length === 1 ? width / 2 : (index / (series.length - 1)) * width,
      y: 140 - ((value - min) / range) * (height - 20),
    }));
  }

  protected linePath() {
    const points = this.points();

    if (!points.length) {
      return '';
    }

    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y}`;
    }

    let path = `M ${points[0].x} ${points[0].y}`;

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const controlX = (previous.x + current.x) / 2;
      path += ` Q ${controlX} ${previous.y}, ${current.x} ${current.y}`;
    }

    return path;
  }

  protected areaPath() {
    const points = this.points();

    if (!points.length) {
      return '';
    }

    const baseline = 156;
    return `${this.linePath()} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
  }

  protected safeLabels() {
    return this.labels.length === this.safeSeries().length
      ? this.labels
      : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  }

  protected trackLabel(index: number) {
    return index;
  }

  protected trackPoint(index: number) {
    return index;
  }

  private safeSeries() {
    return this.data.length >= 2 ? this.data : this.fallbackSeries;
  }
}
