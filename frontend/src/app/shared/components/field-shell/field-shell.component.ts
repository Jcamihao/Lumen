import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-field-shell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './field-shell.component.html',
  styleUrls: ['./field-shell.component.scss'],
})
export class FieldShellComponent {
  @Input({ required: true }) label!: string;
  @Input() hint = '';
}
