import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'lumen.theme';
  private readonly modeSignal = signal<ThemeMode>(
    (localStorage.getItem(this.storageKey) as ThemeMode | null) ?? 'light',
  );

  readonly mode = this.modeSignal.asReadonly();

  constructor() {
    this.applyTheme(this.modeSignal());
  }

  toggle() {
    const nextMode = this.modeSignal() === 'light' ? 'dark' : 'light';
    this.modeSignal.set(nextMode);
    this.applyTheme(nextMode);
  }

  private applyTheme(mode: ThemeMode) {
    document.documentElement.dataset['theme'] = mode;
    localStorage.setItem(this.storageKey, mode);
  }
}
