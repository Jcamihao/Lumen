import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastEntry = {
  id: string;
  message: string;
  tone: ToastTone;
};

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<ToastEntry[]>([]);

  show(message: string, tone: ToastTone = 'info', durationMs = 3200) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.toasts.update((list) => [...list, { id, message, tone }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  success(message: string) {
    this.show(message, 'success');
  }

  error(message: string) {
    this.show(message, 'error');
  }

  dismiss(id: string) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
