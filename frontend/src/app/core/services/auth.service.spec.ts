import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { NetworkService } from './network.service';
import { NativeStorageService } from './native-storage.service';

describe('AuthService', () => {
  let networkServiceSpy: jasmine.SpyObj<NetworkService>;
  let storageSpy: jasmine.SpyObj<NativeStorageService>;
  let routerSpy: jasmine.SpyObj<Router>;
  let httpMock: HttpTestingController;

  const configureWith = (options: {
    isNativePlatform: boolean;
    isOnline: boolean;
    storedUser?: Record<string, unknown>;
  }) => {
    networkServiceSpy = jasmine.createSpyObj('NetworkService', ['isOnline']);
    networkServiceSpy.isOnline.and.returnValue(options.isOnline);

    storageSpy = jasmine.createSpyObj('NativeStorageService', [
      'isNativePlatform',
      'getSessionItem',
      'setSessionItem',
      'removeSessionItem',
      'getItem',
      'setItem',
      'removeItem',
    ]);
    storageSpy.isNativePlatform.and.returnValue(options.isNativePlatform);
    storageSpy.getSessionItem.and.returnValue(null);
    storageSpy.getItem.and.returnValue(
      options.storedUser ? JSON.stringify(options.storedUser) : null,
    );

    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NetworkService, useValue: networkServiceSpy },
        { provide: NativeStorageService, useValue: storageSpy },
        { provide: Router, useValue: routerSpy },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  };

  afterEach(() => {
    httpMock?.verify();
  });

  describe('isAuthenticated / canUseOfflineSession / hasSession', () => {
    it('reports no session and cannot use offline session before any login', () => {
      const service = configureWith({ isNativePlatform: true, isOnline: true });

      expect(service.isAuthenticated()).toBe(false);
      expect(service.canUseOfflineSession()).toBe(false);
    });

    it('sets isAuthenticated and canUseOfflineSession to true after a successful login', () => {
      const service = configureWith({ isNativePlatform: true, isOnline: true });

      service.login({ email: 'marina@exemplo.com', password: 'secret' }).subscribe();
      const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/login`);
      req.flush({
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
        user: { id: 'user-1', name: 'Marina', email: 'marina@exemplo.com' },
      });

      expect(service.isAuthenticated()).toBe(true);
      expect(service.canUseOfflineSession()).toBe(true);
    });

    it('on native platforms, hasSession depends on having a stored token, not on cookies', () => {
      const service = configureWith({ isNativePlatform: true, isOnline: true });

      expect(service.hasSession()).toBe(false);

      service.login({ email: 'marina@exemplo.com', password: 'secret' }).subscribe();
      httpMock
        .expectOne(`${environment.apiBaseUrl}/auth/login`)
        .flush({
          accessToken: 'access-token-1',
          refreshToken: 'refresh-token-1',
          user: { id: 'user-1', name: 'Marina', email: 'marina@exemplo.com' },
        });

      expect(service.hasSession()).toBe(true);
    });

    it('on web platforms (refresh cookie mode), hasSession is always true regardless of stored tokens', () => {
      const service = configureWith({ isNativePlatform: false, isOnline: true });

      expect(service.hasSession()).toBe(true);
    });
  });

  describe('restoreSession', () => {
    it('resolves synchronously to true when offline and an offline session is usable', (done) => {
      const service = configureWith({ isNativePlatform: true, isOnline: true });
      service.login({ email: 'marina@exemplo.com', password: 'secret' }).subscribe();
      httpMock
        .expectOne(`${environment.apiBaseUrl}/auth/login`)
        .flush({
          accessToken: 'access-token-1',
          refreshToken: 'refresh-token-1',
          user: { id: 'user-1', name: 'Marina', email: 'marina@exemplo.com' },
        });
      networkServiceSpy.isOnline.and.returnValue(false);

      service.restoreSession().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
      httpMock.expectNone(`${environment.apiBaseUrl}/auth/refresh`);
    });

    it('resolves to false when offline and there is no usable offline session', (done) => {
      const service = configureWith({ isNativePlatform: true, isOnline: false });

      service.restoreSession().subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
      httpMock.expectNone(`${environment.apiBaseUrl}/auth/refresh`);
    });

    it('calls the refresh endpoint and restores the session on success', (done) => {
      const service = configureWith({ isNativePlatform: false, isOnline: true });

      service.restoreSession(true).subscribe((result) => {
        expect(result).toBe(true);
        expect(service.isAuthenticated()).toBe(true);
        done();
      });

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/refresh`);
      req.flush({
        accessToken: 'refreshed-access-token',
        refreshToken: 'refreshed-refresh-token',
        user: { id: 'user-1', name: 'Marina', email: 'marina@exemplo.com' },
      });
    });

    it('clears the session and resolves to false when the refresh call fails while online', (done) => {
      const service = configureWith({ isNativePlatform: false, isOnline: true });

      service.restoreSession(true).subscribe((result) => {
        expect(result).toBe(false);
        expect(service.isAuthenticated()).toBe(false);
        done();
      });

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/refresh`);
      req.flush('unauthorized', { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('email flows', () => {
    const unverifiedUser = {
      id: 'user-1',
      name: 'Marina',
      email: 'marina@exemplo.com',
      emailVerifiedAt: null,
    };

    it('posts the forgot-password request with only the email', () => {
      const service = configureWith({ isNativePlatform: false, isOnline: true });

      service.forgotPassword({ email: 'marina@exemplo.com' }).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/forgot-password`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'marina@exemplo.com' });
      req.flush({ success: true, message: 'ok' });
    });

    it('posts the reset-password payload with id, token and the new password', () => {
      const service = configureWith({ isNativePlatform: false, isOnline: true });

      service.resetPassword({ id: 'c-1', token: 't-1', password: 'NovaSenha123!' }).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/reset-password`);
      expect(req.request.body).toEqual({ id: 'c-1', token: 't-1', password: 'NovaSenha123!' });
      req.flush({ success: true });
    });

    it('marks the stored user as verified after a successful email verification', () => {
      const service = configureWith({
        isNativePlatform: false,
        isOnline: true,
        storedUser: unverifiedUser,
      });
      expect(service.currentUser()?.emailVerifiedAt).toBeNull();

      service.verifyEmail({ id: 'c-1', token: 't-1' }).subscribe();
      httpMock.expectOne(`${environment.apiBaseUrl}/auth/verify-email`).flush({ success: true });

      expect(service.currentUser()?.emailVerifiedAt).toBeTruthy();
    });

    it('keeps the verification banner when a resend actually sends a new link', () => {
      const service = configureWith({
        isNativePlatform: false,
        isOnline: true,
        storedUser: unverifiedUser,
      });

      service.resendEmailVerification().subscribe();
      httpMock
        .expectOne(`${environment.apiBaseUrl}/auth/resend-verification`)
        .flush({ success: true, alreadyVerified: false });

      expect(service.currentUser()?.emailVerifiedAt).toBeNull();
    });

    it('clears the banner when the server says the email is already verified', () => {
      const service = configureWith({
        isNativePlatform: false,
        isOnline: true,
        storedUser: unverifiedUser,
      });

      service.resendEmailVerification().subscribe();
      httpMock
        .expectOne(`${environment.apiBaseUrl}/auth/resend-verification`)
        .flush({ success: true, alreadyVerified: true });

      expect(service.currentUser()?.emailVerifiedAt).toBeTruthy();
    });

    it('sends the unsubscribe token in the request body', () => {
      const service = configureWith({ isNativePlatform: false, isOnline: true });

      service.unsubscribeEmail({ token: 'abc.def' }).subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/email-preferences/unsubscribe`);
      expect(req.request.body).toEqual({ token: 'abc.def' });
      req.flush({ success: true, category: 'weekly_digest' });
    });
  });
});
