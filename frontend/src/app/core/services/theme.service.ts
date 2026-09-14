import { Injectable, effect, inject, signal } from '@angular/core';
import { NativeStorageService } from './native-storage.service';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'lumen:theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storage = inject(NativeStorageService);

  readonly theme = signal<ThemeMode>(this.readInitialTheme());

  constructor() {
    effect(() => {
      const theme = this.theme();
      this.applyTheme(theme);
      this.storage.setItem(STORAGE_KEY, theme);
    });
  }

  toggle() {
    this.theme.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  setTheme(theme: ThemeMode) {
    this.theme.set(theme);
  }

  private readInitialTheme(): ThemeMode {
    const stored = this.storage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }

    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  }

  private applyTheme(theme: ThemeMode) {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);

    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'dark' ? '#09090b' : '#111111');
  }
}
