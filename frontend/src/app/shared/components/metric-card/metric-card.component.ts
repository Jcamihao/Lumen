import { CommonModule, CurrencyPipe, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';
import { SpotlightHoverDirective } from '../../directives/spotlight-hover/spotlight-hover.directive';

@Component({
  selector: 'app-metric-card',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, NgClass, SpotlightHoverDirective],
  templateUrl: './metric-card.component.html',
  styleUrls: ['./metric-card.component.scss'],
})
export class MetricCardComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) value!: string | number;
  @Input() caption = '';
  @Input() tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral';
  @Input() currency = false;
  @Input() currencyCode = 'BRL';
}
