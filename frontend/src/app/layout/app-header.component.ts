import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AvatarComponent } from '../shared/components/avatar.component';
import { UiButtonComponent } from '../shared/components/ui-button.component';

@Component({
  selector: 'app-app-header',
  standalone: true,
  imports: [CommonModule, AvatarComponent, UiButtonComponent],
  template: `
    <header class="app-header">
      <div class="copy">
        <p class="section-kicker">{{ eyebrow }}</p>
        <h1>{{ title }}</h1>
        <p class="subtitle">{{ subtitle }}</p>
      </div>

      <div class="actions">
        <app-ui-button
          variant="secondary"
          icon="{{ themeMode === 'light' ? 'dark_mode' : 'light_mode' }}"
          (click)="toggleTheme.emit()"
        >
          {{ themeMode === 'light' ? 'Dark mode' : 'Light mode' }}
        </app-ui-button>

        <app-ui-button icon="add" (click)="quickAction.emit()">
          {{ actionLabel }}
        </app-ui-button>

        <button class="profile" type="button" (click)="logout.emit()">
          <app-avatar [name]="userName"></app-avatar>
          <div>
            <strong>{{ userName }}</strong>
            <span>Sair</span>
          </div>
        </button>
      </div>
    </header>
  `,
  styles: [`
    .app-header {
      position: sticky;
      top: 0;
      z-index: 30;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 0 1.2rem;
      background: linear-gradient(180deg, var(--background) 72%, rgba(245, 246, 248, 0));
      backdrop-filter: blur(8px);
    }

    :root[data-theme='dark'] .app-header {
      background: linear-gradient(180deg, var(--background) 72%, rgba(18, 18, 18, 0));
    }

    .copy {
      display: grid;
      gap: 0.35rem;
      min-width: 0;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.9rem, 3vw, 2.7rem);
      line-height: 1.05;
      letter-spacing: -0.04em;
      color: var(--text-primary);
    }

    .subtitle {
      margin: 0;
      max-width: 42rem;
      color: var(--text-medium);
      font-size: 0.96rem;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      flex-wrap: wrap;
      justify-content: flex-end;
      flex-shrink: 0;
    }

    .profile {
      display: inline-flex;
      align-items: center;
      gap: 0.7rem;
      padding: 0.3rem 0.4rem 0.3rem 0.3rem;
      border-radius: 999px;
      background: var(--card);
      border: 1px solid var(--border);
      box-shadow: var(--shadow-soft);
      cursor: pointer;
    }

    .profile div {
      display: grid;
      gap: 0.05rem;
      text-align: left;
    }

    .profile strong {
      font-size: 0.92rem;
      color: var(--text-primary);
    }

    .profile span {
      font-size: 0.78rem;
      color: var(--text-secondary);
    }

    @media (max-width: 900px) {
      .app-header {
        position: static;
        display: grid;
        gap: 1rem;
        padding-top: 0.4rem;
        background: transparent;
        backdrop-filter: none;
      }

      .actions {
        justify-content: flex-start;
      }
    }

    @media (max-width: 640px) {
      .app-header {
        gap: 0.85rem;
      }

      .subtitle {
        font-size: 0.92rem;
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
      }

      app-ui-button {
        width: 100%;
      }

      .profile div {
        display: none;
      }

      .profile {
        grid-column: 1 / -1;
        justify-self: end;
      }
    }
  `],
})
export class AppHeaderComponent {
  @Input() eyebrow = 'Lumen';
  @Input({ required: true }) title!: string;
  @Input() subtitle = '';
  @Input() actionLabel = 'Nova tarefa';
  @Input() userName = 'Você';
  @Input() themeMode: 'light' | 'dark' = 'light';

  @Output() readonly toggleTheme = new EventEmitter<void>();
  @Output() readonly quickAction = new EventEmitter<void>();
  @Output() readonly logout = new EventEmitter<void>();
}
