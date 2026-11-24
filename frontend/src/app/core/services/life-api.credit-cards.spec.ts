import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { OfflineLifeService } from './offline-life.service';
import { LifeApiService } from './life-api.service';

describe('LifeApiService (cartoes de credito)', () => {
  let service: LifeApiService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiBaseUrl}/credit-cards`;

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
          },
        },
      ],
    });
    service = TestBed.inject(LifeApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listar sem arquivados: GET sem query', () => {
    service.listCreditCards().subscribe();

    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listar com arquivados: GET com includeArchived=true', () => {
    service.listCreditCards(true).subscribe();

    const req = httpMock.expectOne(`${base}?includeArchived=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('criar: POST com nome, fechamento e vencimento nulo', () => {
    service.createCreditCard({ name: 'Inter', closingDay: 10, dueDay: null }).subscribe();

    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Inter', closingDay: 10, dueDay: null });
    req.flush({});
  });

  it('editar: PATCH no id codificado com o corpo parcial', () => {
    service.updateCreditCard('a/b', { name: 'Nu', dueDay: null }).subscribe();

    const req = httpMock.expectOne(`${base}/a%2Fb`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Nu', dueDay: null });
    req.flush({});
  });

  it('arquivar: DELETE no cartao', () => {
    service.archiveCreditCard('c1').subscribe();

    const req = httpMock.expectOne(`${base}/c1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('tornar padrao: POST em /make-default com corpo vazio', () => {
    service.makeDefaultCreditCard('c1').subscribe();

    const req = httpMock.expectOne(`${base}/c1/make-default`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('escritas nao caem em fallback offline: erro 409 chega ao chamador', () => {
    let status: number | undefined;
    service.updateCreditCard('c1', { name: 'Repetido' }).subscribe({
      error: (err) => (status = err.status),
    });

    httpMock.expectOne(`${base}/c1`).flush({}, { status: 409, statusText: 'Conflict' });

    expect(status).toBe(409);
  });
});
