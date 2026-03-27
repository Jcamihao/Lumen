import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `
    <span class="avatar" [class.sm]="size === 'sm'" [class.lg]="size === 'lg'">
      {{ initials() }}
    </span>
  `,
  styles: [`
    .avatar {
      display: inline-grid;
      place-items: center;
      width: 2.65rem;
      height: 2.65rem;
      border-radius: 1rem;
      background:
        radial-gradient(circle at top left, rgba(129, 140, 248, 0.8), transparent 55%),
        linear-gradient(135deg, var(--accent), var(--accent-hover));
      color: #ffffff;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
    }

    .avatar.sm {
      width: 2.2rem;
      height: 2.2rem;
      border-radius: 0.9rem;
      font-size: 0.72rem;
    }

    .avatar.lg {
      width: 3.2rem;
      height: 3.2rem;
      border-radius: 1.2rem;
      font-size: 0.96rem;
    }
  `],
})
export class AvatarComponent {
  @Input() name = 'Lumen';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';

  protected initials() {
    return this.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((chunk) => chunk[0]?.toUpperCase() ?? '')
      .join('') || 'LU';
  }
}
