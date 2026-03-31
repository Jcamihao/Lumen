import { APP_INITIALIZER, Injectable } from "@angular/core";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

@Injectable({ providedIn: "root" })
export class NativeStorageService {
  private readonly keyPrefix = "lumen:";
  private readonly native = Capacitor.isNativePlatform();

  async hydrateLocalCache() {
    if (!this.native || typeof window === "undefined") {
      return;
    }

    try {
      const { keys } = await Preferences.keys();

      await Promise.all(
        keys
          .filter((key) => key.startsWith(this.keyPrefix))
          .map(async (key) => {
            const { value } = await Preferences.get({ key });

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
      void Preferences.set({ key, value });
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
      void Preferences.remove({ key });
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
