import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ToastEntry, ToastService } from '../../core/services/toast.service';

@Component({
    selector: 'app-toast',
    imports: [CommonModule, RouterLink],
    templateUrl: './toast.component.html',
    styleUrls: ['./toast.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToastComponent {
  protected readonly toastService = inject(ToastService);

  protected toneIcon(tone: ToastEntry['tone']) {
    return { success: 'check_circle', error: 'error', info: 'info' }[tone];
  }

  protected trackById(_: number, toast: ToastEntry) {
    return toast.id;
  }
}
