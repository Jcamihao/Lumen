import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './avatar.component.html',
  styleUrls: ['./avatar.component.scss'],
})
export class AvatarComponent {
  @Input() name = 'Lumen';
  @Input() imageUrl: string | null = null;
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() shape: 'rounded' | 'circle' = 'rounded';

  protected initials() {
    return this.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((chunk) => chunk[0]?.toUpperCase() ?? '')
      .join('') || 'LU';
  }
}
