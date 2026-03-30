import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { SpotlightHoverDirective } from '../../directives/spotlight-hover/spotlight-hover.directive';

@Component({
  selector: 'app-panel',
  standalone: true,
  imports: [CommonModule, SpotlightHoverDirective],
  templateUrl: './panel.component.html',
  styleUrls: ['./panel.component.scss'],
})
export class PanelComponent {
  @Input() title = '';
  @Input() caption = '';
  @Input() height = '';
  @Input() maxHeight = '';
}
