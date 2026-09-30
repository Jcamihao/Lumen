import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastAction = { label: string; route: string };

export type ToastEntry = {
  id: string;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
};

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<ToastEntry[]>([]);

  show(message: string, tone: ToastTone = 'info', durationMs = 3200, action?: ToastAction) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry: ToastEntry = action ? { id, message, tone, action } : { id, message, tone };
    this.toasts.update((list) => [...list, entry]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  success(message: string) {
    this.show(message, 'success');
  }

  error(message: string) {
    this.show(message, 'error');
  }

  errorWithAction(message: string, action: ToastAction) {
    this.show(message, 'error', 3200, action);
  }

  dismiss(id: string) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
