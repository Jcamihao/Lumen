import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <button
      type="button"
      class="theme-toggle"
      [class.theme-toggle--glass]="variant === 'glass'"
      [attr.aria-label]="theme.theme() === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'"
      [attr.aria-pressed]="theme.theme() === 'dark'"
      (click)="theme.toggle()"
    >
      <span class="material-symbols-rounded">{{ theme.theme() === 'dark' ? 'dark_mode' : 'light_mode' }}</span>
    </button>
  `,
  styleUrls: ['./theme-toggle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  @Input() variant: 'default' | 'glass' = 'default';

  protected readonly theme = inject(ThemeService);
}
