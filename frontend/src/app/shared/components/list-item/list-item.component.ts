import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';
import { AvatarComponent } from '../avatar/avatar.component';
import { UiBadgeComponent } from '../ui-badge/ui-badge.component';
import { SpotlightHoverDirective } from '../../directives/spotlight-hover/spotlight-hover.directive';

@Component({
  selector: 'app-list-item',
  standalone: true,
  imports: [CommonModule, NgClass, AvatarComponent, UiBadgeComponent, SpotlightHoverDirective],
  templateUrl: './list-item.component.html',
  styleUrls: ['./list-item.component.scss'],
})
export class ListItemComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle = '';
  @Input() meta = '';
  @Input() metaTone: 'neutral' | 'positive' | 'negative' | 'warning' = 'neutral';
  @Input() badge = '';
  @Input() badgeTone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'dark' = 'neutral';
  @Input() badgePlacement: 'title' | 'trailing' = 'title';
  @Input() avatar = '';
  @Input() icon = '';
  @Input() checkable = false;
  @Input() checked = false;
}
