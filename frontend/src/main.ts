import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app/app.component';
import { appConfig } from './app/app.config';

registerLocaleData(localePt);

if (isDevMode() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    .catch((error) => console.warn('[Lumen dev] service worker cleanup failed', error));
}

if (isDevMode() && typeof caches !== 'undefined') {
  caches
    .keys()
    .then((keys) =>
      Promise.all(keys.filter((key) => key.includes('ngsw')).map((key) => caches.delete(key))),
    )
    .catch((error) => console.warn('[Lumen dev] cache cleanup failed', error));
}

bootstrapApplication(AppComponent, appConfig).catch((error) =>
  console.error('[Lumen bootstrap failed]', error),
);
