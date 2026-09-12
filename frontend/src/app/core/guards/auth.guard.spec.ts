import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { authGuard, guestGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { NetworkService } from '../services/network.service';

describe('authGuard', () => {
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let networkServiceSpy: jasmine.SpyObj<NetworkService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', [
      'isAuthenticated',
      'canUseOfflineSession',
      'hasSession',
      'restoreSession',
    ]);
    networkServiceSpy = jasmine.createSpyObj('NetworkService', ['isOnline']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: NetworkService, useValue: networkServiceSpy },
        { provide: Router, useValue: routerSpy },
      ],
    });
  });

  const runGuard = () =>
    TestBed.runInInjectionContext(() => authGuard({} as any, {} as any));

  it('allows navigation when the user is already authenticated', () => {
    authServiceSpy.isAuthenticated.and.returnValue(true);

    const result = runGuard();

    expect(result).toBe(true);
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('allows navigation while offline when an offline session is usable', () => {
    authServiceSpy.isAuthenticated.and.returnValue(false);
    networkServiceSpy.isOnline.and.returnValue(false);
    authServiceSpy.canUseOfflineSession.and.returnValue(true);

    const result = runGuard();

    expect(result).toBe(true);
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('redirects to login when there is no session at all', () => {
    authServiceSpy.isAuthenticated.and.returnValue(false);
    networkServiceSpy.isOnline.and.returnValue(true);
    authServiceSpy.hasSession.and.returnValue(false);

    const result = runGuard();

    expect(result).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('restores the session and allows navigation when restoration succeeds', (done) => {
    authServiceSpy.isAuthenticated.and.returnValue(false);
    networkServiceSpy.isOnline.and.returnValue(true);
    authServiceSpy.hasSession.and.returnValue(true);
    authServiceSpy.restoreSession.and.returnValue(of(true));

    const result$ = runGuard() as Observable<boolean>;
    result$.subscribe((authenticated) => {
      expect(authenticated).toBe(true);
      expect(routerSpy.navigate).not.toHaveBeenCalled();
      done();
    });
  });

  it('redirects to login when session restoration fails', (done) => {
    authServiceSpy.isAuthenticated.and.returnValue(false);
    networkServiceSpy.isOnline.and.returnValue(true);
    authServiceSpy.hasSession.and.returnValue(true);
    authServiceSpy.restoreSession.and.returnValue(of(false));

    const result$ = runGuard() as Observable<boolean>;
    result$.subscribe((authenticated) => {
      expect(authenticated).toBe(false);
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
      done();
    });
  });
});

describe('guestGuard', () => {
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    authServiceSpy = jasmine.createSpyObj('AuthService', ['isAuthenticated']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: routerSpy },
      ],
    });
  });

  const runGuard = () =>
    TestBed.runInInjectionContext(() => guestGuard({} as any, {} as any));

  it('redirects an already authenticated user away from guest-only pages', () => {
    authServiceSpy.isAuthenticated.and.returnValue(true);

    const result = runGuard();

    expect(result).toBe(false);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('allows an unauthenticated user to reach guest-only pages', (done) => {
    authServiceSpy.isAuthenticated.and.returnValue(false);

    const result$ = runGuard() as Observable<boolean>;
    result$.subscribe((allowed) => {
      expect(allowed).toBe(true);
      expect(routerSpy.navigate).not.toHaveBeenCalled();
      done();
    });
  });
});
