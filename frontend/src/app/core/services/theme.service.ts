import { Injectable, inject, signal } from '@angular/core';
import { NativeStorageService } from './native-storage.service';

export type ThemeMode = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storage = inject(NativeStorageService);
  private readonly storageKey = 'lumen.theme';
  private readonly modeSignal = signal<ThemeMode>(
    (this.storage.getItem(this.storageKey) as ThemeMode | null) ?? 'light',
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
    this.storage.setItem(this.storageKey, mode);
  }
}
