import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  templateUrl: './empty-state.component.html',
  styleUrls: ['./empty-state.component.scss'],
})
export class EmptyStateComponent {
  @Input() icon = 'tips_and_updates';
  @Input() title = 'Nada por aqui';
  @Input() description = 'Quando houver dados, eles vao aparecer aqui.';
}
