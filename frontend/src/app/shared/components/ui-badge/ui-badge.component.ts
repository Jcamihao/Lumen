import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-ui-badge',
  standalone: true,
  imports: [CommonModule, NgClass],
  templateUrl: './ui-badge.component.html',
  styleUrls: ['./ui-badge.component.scss'],
})
export class UiBadgeComponent {
  @Input({ required: true }) label!: string;
  @Input() tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'dark' = 'neutral';
  @Input() showDot = true;
}
