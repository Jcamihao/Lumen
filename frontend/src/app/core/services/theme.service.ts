import { Injectable, computed, inject, signal } from '@angular/core';
import { NativeStorageService } from './native-storage.service';

export type ThemeMode = 'light' | 'dark';
export type ThemeId = 'atelier' | 'jardim' | 'brasa' | 'mare';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  badge: string;
  description: string;
  mode: ThemeMode;
  pairId: ThemeId;
  preview: {
    start: string;
    mid: string;
    end: string;
    surface: string;
    ink: string;
    accent: string;
  };
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'atelier',
    label: 'Atelier',
    badge: 'claro quente',
    description: 'Papel creme, terracota e um brilho acolhedor.',
    mode: 'light',
    pairId: 'brasa',
    preview: {
      start: '#f4efe7',
      mid: '#fffaf4',
      end: '#e08a62',
      surface: '#fff7f0',
      ink: '#2f3f35',
      accent: '#c75c3c',
    },
  },
  {
    id: 'jardim',
    label: 'Jardim',
    badge: 'claro sereno',
    description: 'Sálvia, areia fresca e detalhes em jade.',
    mode: 'light',
    pairId: 'mare',
    preview: {
      start: '#eef3ec',
      mid: '#fbfdf9',
      end: '#7ea07a',
      surface: '#f5faf5',
      ink: '#23453a',
      accent: '#5f7f69',
    },
  },
  {
    id: 'brasa',
    label: 'Brasa',
    badge: 'escuro aconchegante',
    description: 'Noite âmbar com cobre suave e profundidade quente.',
    mode: 'dark',
    pairId: 'atelier',
    preview: {
      start: '#171814',
      mid: '#232621',
      end: '#a4694e',
      surface: '#2a2b25',
      ink: '#f5eadf',
      accent: '#e08a62',
    },
  },
  {
    id: 'mare',
    label: 'Maré',
    badge: 'escuro profundo',
    description: 'Grafite, petróleo e um brilho mineral mais frio.',
    mode: 'dark',
    pairId: 'jardim',
    preview: {
      start: '#10161a',
      mid: '#172129',
      end: '#5e88a6',
      surface: '#1d2730',
      ink: '#edf4f7',
      accent: '#67a3b0',
    },
  },
];

const THEME_OPTIONS_BY_ID = THEME_OPTIONS.reduce<Record<ThemeId, ThemeOption>>(
  (accumulator, theme) => {
    accumulator[theme.id] = theme;
    return accumulator;
  },
  {} as Record<ThemeId, ThemeOption>,
);

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storage = inject(NativeStorageService);
  private readonly storageKey = 'lumen.theme';
  private readonly themeSignal = signal<ThemeId>(
    this.normalizeThemeId(this.storage.getItem(this.storageKey)),
  );

  readonly themes = THEME_OPTIONS;
  readonly themeId = this.themeSignal.asReadonly();
  readonly currentTheme = computed(
    () => THEME_OPTIONS_BY_ID[this.themeSignal()],
  );
  readonly mode = computed(() => this.currentTheme().mode);

  constructor() {
    this.applyTheme(this.themeSignal());
  }

  toggle() {
    this.setTheme(this.currentTheme().pairId);
  }

  setTheme(themeId: ThemeId) {
    const nextTheme = this.normalizeThemeId(themeId);
    this.themeSignal.set(nextTheme);
    this.applyTheme(nextTheme);
  }

  private applyTheme(themeId: ThemeId) {
    const theme = THEME_OPTIONS_BY_ID[themeId];

    document.documentElement.dataset['theme'] = theme.id;
    document.documentElement.dataset['themeMode'] = theme.mode;
    this.storage.setItem(this.storageKey, theme.id);
  }

  private normalizeThemeId(value: string | null): ThemeId {
    if (value === 'light') {
      return 'atelier';
    }

    if (value === 'dark') {
      return 'brasa';
    }

    if (value && value in THEME_OPTIONS_BY_ID) {
      return value as ThemeId;
    }

    return 'atelier';
  }
}
