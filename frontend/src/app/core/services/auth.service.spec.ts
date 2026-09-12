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
    storageSpy.getItem.and.returnValue(null);

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
});
