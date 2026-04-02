import { APP_INITIALIZER, Injectable } from "@angular/core";

type PreferencesApi = {
  keys(): Promise<{ keys: string[] }>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

@Injectable({ providedIn: "root" })
export class NativeStorageService {
  private readonly keyPrefix = "lumen:";
  private readonly native = this.readNativePlatform();
  private preferencesPromise: Promise<PreferencesApi | null> | null = null;

  isNativePlatform() {
    return this.native;
  }

  async hydrateLocalCache() {
    if (!this.native || typeof window === "undefined") {
      return;
    }

    try {
      const preferences = await this.getPreferences();

      if (!preferences) {
        return;
      }

      const { keys } = await preferences.keys();

      await Promise.all(
        keys
          .filter((key) => key.startsWith(this.keyPrefix))
          .map(async (key) => {
            const { value } = await preferences.get({ key });

            if (value !== null) {
              window.localStorage.setItem(key, value);
            }
          }),
      );
    } catch {
      // Ignore native storage bootstrap failures and fall back to the web cache.
    }
  }

  getItem(key: string) {
    try {
      return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string) {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // Ignore browser storage errors and still try the native mirror.
    }

    if (this.native) {
      void this.runNativeOperation((preferences) => preferences.set({ key, value }));
    }
  }

  removeItem(key: string) {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore browser storage errors and still try the native mirror.
    }

    if (this.native) {
      void this.runNativeOperation((preferences) => preferences.remove({ key }));
    }
  }

  getSessionItem(key: string) {
    if (this.native) {
      return this.getItem(key);
    }

    try {
      if (typeof window === "undefined") {
        return null;
      }

      const sessionValue = window.sessionStorage.getItem(key);

      if (sessionValue !== null) {
        return sessionValue;
      }

      const legacyValue = window.localStorage.getItem(key);

      if (legacyValue !== null) {
        window.sessionStorage.setItem(key, legacyValue);
        window.localStorage.removeItem(key);
      }

      return legacyValue;
    } catch {
      return null;
    }
  }

  setSessionItem(key: string, value: string) {
    if (this.native) {
      this.setItem(key, value);
      return;
    }

    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore browser storage errors for session-scoped values.
    }
  }

  removeSessionItem(key: string) {
    if (this.native) {
      this.removeItem(key);
      return;
    }

    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(key);
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore browser storage errors when cleaning session-scoped values.
    }
  }

  private readNativePlatform() {
    const capacitor = (globalThis as {
      Capacitor?: {
        isNativePlatform?: () => boolean;
      };
    }).Capacitor;

    return Boolean(capacitor?.isNativePlatform?.());
  }

  private async getPreferences() {
    if (!this.native) {
      return null;
    }

    if (!this.preferencesPromise) {
      this.preferencesPromise = import("@capacitor/preferences")
        .then((module) => module.Preferences as PreferencesApi)
        .catch(() => null);
    }

    return this.preferencesPromise;
  }

  private async runNativeOperation(
    operation: (preferences: PreferencesApi) => Promise<void>,
  ) {
    try {
      const preferences = await this.getPreferences();

      if (!preferences) {
        return;
      }

      await operation(preferences);
    } catch {
      // Ignore native storage errors and keep the web cache as fallback.
    }
  }
}

export function provideNativeStorageInitializer() {
  return {
    provide: APP_INITIALIZER,
    multi: true,
    useFactory: (nativeStorage: NativeStorageService) => () =>
      nativeStorage.hydrateLocalCache(),
    deps: [NativeStorageService],
  };
}
