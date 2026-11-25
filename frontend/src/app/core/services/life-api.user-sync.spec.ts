import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { OfflineLifeService } from './offline-life.service';
import { LifeApiService } from './life-api.service';

/*
 * Reproducao da fila offline para o PATCH /users/me (11b-1b): filas gravadas por versoes
 * antigas trazem o espelho de ciclo (monthClosingDay/creditDueDay/creditCycleCountAllPayments),
 * que o backend de hoje recusa com 400 (whitelist) e travaria a fila inteira atras do item.
 */
describe('LifeApiService: reproducao da fila de usuario sem o espelho de ciclo', () => {
  let service: LifeApiService;
  let httpMock: HttpTestingController;
  const reconcileUser = jasmine.createSpy('reconcileUser');
  const base = `${environment.apiBaseUrl}/users/me`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: OfflineLifeService,
          useValue: {
            pendingSyncCount: signal(0),
            failedSyncCount: signal(0),
            activeSyncItemCount: signal(0),
            syncQueueItems: signal([]),
            hasPendingSync: () => false,
            reconcileUser,
          },
        },
      ],
    });
    service = TestBed.inject(LifeApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const flushItem = (payload?: Record<string, unknown>) =>
    (service as unknown as {
      flushQueueItem(item: { entity: string; action: string; payload?: Record<string, unknown> }): Promise<void>;
    }).flushQueueItem({ entity: 'user', action: 'update', payload });

  it('payload velho com nome + espelho: PATCH sai so com o nome', async () => {
    const done = flushItem({ name: 'Ana', monthClosingDay: 12, creditDueDay: 5 });

    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Ana' });
    req.flush({ id: 'user-1', name: 'Ana' });
    await done;

    expect(reconcileUser).toHaveBeenCalledWith({ id: 'user-1', name: 'Ana' });
  });

  it('payload so com espelho (sobrinha pura do bug): nenhum PATCH sai e o item conclui', async () => {
    await flushItem({ monthClosingDay: 9 });

    httpMock.expectNone(base);
    expect(reconcileUser).not.toHaveBeenCalled();
  });

  it('payload vazio tambem conclui sem requisicao', async () => {
    await flushItem(undefined);

    httpMock.expectNone(base);
  });
});
