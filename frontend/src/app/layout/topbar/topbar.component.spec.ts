import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { LOCALE_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { LifeApiService } from '../../core/services/life-api.service';
import { NotificationCenterService } from '../../core/services/notification-center.service';
import { TopbarComponent } from './topbar.component';

// O app registra o pt-BR no main.ts; o ambiente de teste nao passa por la.
registerLocaleData(localePt);

describe('TopbarComponent — busca global', () => {
  let api: jasmine.SpyObj<LifeApiService>;
  let fixture: ComponentFixture<TopbarComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const input = () => root().querySelector('input[type="search"]') as HTMLInputElement;

  const focusSearch = () => {
    input().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
  };

  const type = (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('LifeApiService', [
      'listTasks',
      'listTransactions',
      'listGoals',
      'listInsights',
    ]);
    api.listTasks.and.returnValue(of([]));
    api.listTransactions.and.returnValue(
      of([
        {
          id: 'tx-1',
          type: 'EXPENSE',
          description: 'Aluguel de setembro',
          amount: 1200,
          date: '2026-09-05T00:00:00.000Z',
        },
      ]),
    );
    api.listGoals.and.returnValue(of([]));
    api.listInsights.and.returnValue(of([]));

    TestBed.configureTestingModule({
      imports: [TopbarComponent],
      providers: [
        provideRouter([]),
        { provide: LOCALE_ID, useValue: 'pt-BR' },
        { provide: LifeApiService, useValue: api },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ name: 'Marina', preferredCurrency: 'BRL' }) },
        },
        {
          provide: NotificationCenterService,
          useValue: { unreadCount: signal(0) },
        },
      ],
    });

    fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();
  });

  it('nao busca nada ao abrir o app (antes eram 4 requisicoes a cada abertura)', () => {
    expect(api.listTasks).not.toHaveBeenCalled();
    expect(api.listTransactions).not.toHaveBeenCalled();
    expect(api.listGoals).not.toHaveBeenCalled();
    expect(api.listInsights).not.toHaveBeenCalled();
  });

  it('busca os quatro conjuntos na primeira vez que o campo recebe foco', () => {
    focusSearch();

    expect(api.listTasks).toHaveBeenCalledTimes(1);
    expect(api.listTransactions).toHaveBeenCalledTimes(1);
    expect(api.listGoals).toHaveBeenCalledTimes(1);
    expect(api.listInsights).toHaveBeenCalledTimes(1);
  });

  it('nao repete a busca nos focos seguintes', () => {
    focusSearch();
    focusSearch();
    focusSearch();

    expect(api.listTransactions).toHaveBeenCalledTimes(1);
  });

  it('a busca acha resultado nos dados carregados no foco', () => {
    focusSearch();
    type('aluguel');

    expect(root().textContent).toContain('Aluguel de setembro');
  });

  it('se o carregamento falhar, o proximo foco tenta de novo', () => {
    api.listGoals.and.returnValue(throwError(() => new Error('rede')));

    focusSearch();
    expect(api.listGoals).toHaveBeenCalledTimes(1);

    api.listGoals.and.returnValue(of([]));
    focusSearch();
    expect(api.listGoals).toHaveBeenCalledTimes(2);
  });

  it('nao mostra mais o atalho ⌘K', () => {
    expect(root().textContent).not.toContain('⌘K');
    expect(root().querySelector('kbd')).toBeNull();
  });
});
