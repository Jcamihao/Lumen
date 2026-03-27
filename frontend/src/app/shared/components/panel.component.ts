import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section
      class="panel"
      [class.has-bounded-height]="!!maxHeight"
      [style.maxHeight]="maxHeight || null"
    >
      <header class="panel-header" *ngIf="title || caption">
        <div>
          <h2>{{ title }}</h2>
          <p *ngIf="caption">{{ caption }}</p>
        </div>
        <ng-content select="[panel-actions]"></ng-content>
      </header>
      <ng-content></ng-content>
    </section>
  `,
  styles: [`
    :host {
      display: block;
    }

    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      padding: 1.35rem;
      box-shadow: var(--shadow-card);
    }

    .panel.has-bounded-height {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.25rem;
    }

    h2 {
      margin: 0;
      font-size: 1.02rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    p {
      margin: 0.3rem 0 0;
      color: var(--text-medium);
      font-size: 0.92rem;
      max-width: 34rem;
    }

    @media (max-width: 640px) {
      .panel {
        padding: 1.15rem;
        border-radius: var(--radius-lg);
      }

      .panel-header {
        margin-bottom: 1rem;
      }
    }
  `],
})
export class PanelComponent {
  @Input() title = '';
  @Input() caption = '';
  @Input() maxHeight = '';
}
