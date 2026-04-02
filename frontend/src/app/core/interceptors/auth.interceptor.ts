import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NativeStorageService } from '../services/native-storage.service';
import { NetworkService } from '../services/network.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const authService = inject(AuthService);
  const nativeStorageService = inject(NativeStorageService);
  const networkService = inject(NetworkService);
  const accessToken = authService.getAccessToken();
  const isApiRequest = request.url.startsWith(environment.apiBaseUrl);
  const clientPlatform = nativeStorageService.isNativePlatform()
    ? 'native'
    : 'web';

  const authorizedRequest = request.clone({
    withCredentials: isApiRequest,
    setHeaders: {
      ...(isApiRequest
        ? {
            'X-LUMEN-Client-Platform': clientPlatform,
          }
        : {}),
      ...(accessToken && isApiRequest
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {}),
    },
  });

  return next(authorizedRequest).pipe(
    catchError((error) => {
      if (error.status === 401 && networkService.isOnline()) {
        authService.clearSession();
      }

      return throwError(() => error);
    }),
  );
};
