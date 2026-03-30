import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NetworkService } from '../services/network.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const networkService = inject(NetworkService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  if (!networkService.isOnline() && authService.canUseOfflineSession()) {
    return true;
  }

  if (!authService.hasSession()) {
    router.navigate(['/auth/login']);
    return false;
  }

  return authService.restoreSession().pipe(
    map((authenticated) => {
      if (!authenticated) {
        router.navigate(['/auth/login']);
      }

      return authenticated;
    }),
  );
};

export const guestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    router.navigate(['/dashboard']);
    return false;
  }

  return of(true);
};
