import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const authService = inject(AuthService);
  const accessToken = authService.getAccessToken();

  const authorizedRequest = accessToken
    ? request.clone({
        setHeaders: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    : request;

  return next(authorizedRequest).pipe(
    catchError((error) => {
      if (error.status === 401) {
        authService.clearSession();
      }

      return throwError(() => error);
    }),
  );
};
