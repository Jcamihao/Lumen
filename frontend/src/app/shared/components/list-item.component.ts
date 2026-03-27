import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';
import { AvatarComponent } from './avatar.component';
import { UiBadgeComponent } from './ui-badge.component';

@Component({
  selector: 'app-list-item',
  standalone: true,
  imports: [CommonModule, NgClass, AvatarComponent, UiBadgeComponent],
  template: `
    <article class="list-item">
      <div class="leading" *ngIf="checkable || avatar || icon">
        <span class="checkmark" *ngIf="checkable" [class.checked]="checked">
          <span class="material-symbols-rounded">
            {{ checked ? 'check_circle' : 'radio_button_unchecked' }}
          </span>
        </span>
        <app-avatar *ngIf="avatar && !checkable" [name]="avatar" size="sm"></app-avatar>
        <span class="leading-icon material-symbols-rounded" *ngIf="icon && !avatar && !checkable">
          {{ icon }}
        </span>
      </div>

      <div class="content">
        <div class="title-row">
          <strong>{{ title }}</strong>
          <app-ui-badge
            *ngIf="badge"
            [label]="badge"
            [tone]="badgeTone"
            [showDot]="false"
          />
        </div>
        <p *ngIf="subtitle">{{ subtitle }}</p>
      </div>

      <div class="trailing">
        <span class="meta" *ngIf="meta" [ngClass]="metaTone">{{ meta }}</span>
        <ng-content select="[list-actions]"></ng-content>
      </div>
    </article>
  `,
  styles: [`
    .list-item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 0.95rem;
      padding: 1rem;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      background: var(--card-muted);
      transition:
        transform var(--transition-fast),
        border-color var(--transition-fast),
        box-shadow var(--transition-fast);
    }

    .list-item:hover {
      transform: translateY(-1px);
      border-color: rgba(99, 102, 241, 0.2);
      box-shadow: var(--shadow-soft);
    }

    .leading {
      display: inline-flex;
      align-items: center;
    }

    .checkmark,
    .leading-icon {
      display: inline-grid;
      place-items: center;
      width: 2.2rem;
      height: 2.2rem;
      border-radius: 0.9rem;
      background: rgba(99, 102, 241, 0.1);
      color: var(--accent);
    }

    .checkmark.checked {
      background: rgba(16, 185, 129, 0.12);
      color: var(--success);
    }

    .content {
      min-width: 0;
    }

    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.8rem;
      flex-wrap: wrap;
    }

    strong {
      font-size: 0.96rem;
      font-weight: 700;
      color: var(--text-primary);
      word-break: break-word;
    }

    p {
      margin: 0.24rem 0 0;
      color: var(--text-medium);
      font-size: 0.9rem;
      word-break: break-word;
    }

    .trailing {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding-left: 3.15rem;
    }

    .meta {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text-medium);
      word-break: break-word;
    }

    .meta.positive {
      color: var(--success);
    }

    .meta.negative {
      color: var(--danger);
    }

    .meta.warning {
      color: var(--warning);
    }

    @media (min-width: 640px) {
      .list-item {
        grid-template-columns: auto minmax(0, 1fr) auto;
      }

      .trailing {
        grid-column: auto;
        padding-left: 0;
        justify-content: flex-end;
      }
    }

    @media (max-width: 479px) {
      .list-item {
        padding: 0.9rem;
      }

      .title-row {
        align-items: flex-start;
        flex-direction: column;
      }

      .trailing {
        padding-left: 0;
        justify-content: flex-start;
      }
    }
  `],
})
export class ListItemComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle = '';
  @Input() meta = '';
  @Input() metaTone: 'neutral' | 'positive' | 'negative' | 'warning' = 'neutral';
  @Input() badge = '';
  @Input() badgeTone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'dark' = 'neutral';
  @Input() avatar = '';
  @Input() icon = '';
  @Input() checkable = false;
  @Input() checked = false;
}
