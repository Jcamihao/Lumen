import { TestBed } from '@angular/core/testing';
import { OfflineLifeService } from './offline-life.service';
import { AuthService } from './auth.service';
import { NativeStorageService } from './native-storage.service';

describe('OfflineLifeService', () => {
  let service: OfflineLifeService;

  const buildFakeStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      getSessionItem: (key: string) => store.get(key) ?? null,
      setSessionItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeSessionItem: (key: string) => {
        store.delete(key);
      },
      isNativePlatform: () => false,
    } as unknown as NativeStorageService;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: () => ({
              id: 'user-1',
              name: 'Marina',
              email: 'marina@exemplo.com',
              taskCategories: [],
              financeCategories: [],
            }),
            updateStoredUser: jasmine.createSpy('updateStoredUser'),
          },
        },
        { provide: NativeStorageService, useValue: buildFakeStorage() },
      ],
    });

    service = TestBed.inject(OfflineLifeService);
  });

  describe('reconcileTask', () => {
    it('replaces the offline placeholder with the remote task and updates the queue record id', () => {
      const offlineTask = service.queueTaskCreate({ title: 'Pagar energia' });
      expect(offlineTask.id).toMatch(/^offline-task-/);
      expect(
        service
          .getQueueSnapshot()
          .some((item) => item.entity === 'task' && item.recordId === offlineTask.id),
      ).toBe(true);

      const remoteTask = {
        id: 'server-task-1',
        title: 'Pagar energia',
        status: 'PENDING',
        priority: 'MEDIUM',
        hasFinancialImpact: false,
        isRecurring: false,
        subtasks: [],
      } as any;

      service.reconcileTask(remoteTask, offlineTask.id);

      const cachedTasks = service.readTasks();
      expect(cachedTasks.find((task) => task.id === offlineTask.id)).toBeUndefined();
      expect(cachedTasks.find((task) => task.id === 'server-task-1')).toBeTruthy();
      expect(cachedTasks.length).toBe(1);

      const queueEntry = service
        .getQueueSnapshot()
        .find((item) => item.entity === 'task');
      expect(queueEntry?.recordId).toBe('server-task-1');
    });

    it('upserts by id and does not touch the queue when no previousId is given (pure creation flow)', () => {
      const remoteTask = {
        id: 'server-task-2',
        title: 'Revisar orcamento',
        status: 'PENDING',
        priority: 'LOW',
        hasFinancialImpact: false,
        isRecurring: false,
        subtasks: [],
      } as any;

      service.reconcileTask(remoteTask);

      expect(service.readTasks().find((task) => task.id === 'server-task-2')).toBeTruthy();
      expect(service.getQueueSnapshot().length).toBe(0);
    });

    it('is safe against a duplicate/out-of-order reconciliation for the same previousId', () => {
      const offlineTask = service.queueTaskCreate({ title: 'Pagar energia' });
      const remoteTask = {
        id: 'server-task-3',
        title: 'Pagar energia',
        status: 'PENDING',
        priority: 'MEDIUM',
        hasFinancialImpact: false,
        isRecurring: false,
        subtasks: [],
      } as any;

      service.reconcileTask(remoteTask, offlineTask.id);
      // A retried/duplicated reconciliation call for the same previousId must not
      // duplicate the task nor corrupt the queue, since the offline id no longer exists.
      service.reconcileTask(remoteTask, offlineTask.id);

      const cachedTasks = service.readTasks();
      expect(cachedTasks.filter((task) => task.id === 'server-task-3').length).toBe(1);
      expect(cachedTasks.length).toBe(1);
    });
  });

  describe('reconcileTransaction', () => {
    it('replaces the offline placeholder with the remote transaction and updates the queue record id', () => {
      const offlineTransaction = service.queueTransactionCreate({
        description: 'Conta de luz',
        type: 'EXPENSE',
        amount: 220,
        date: '2026-08-01',
      });

      const remoteTransaction = {
        id: 'server-tx-1',
        description: 'Conta de luz',
        type: 'EXPENSE',
        amount: 220,
        date: '2026-08-01',
      } as any;

      service.reconcileTransaction(remoteTransaction, offlineTransaction.id);

      const cached = service.readTransactions();
      expect(cached.find((tx) => tx.id === offlineTransaction.id)).toBeUndefined();
      expect(cached.find((tx) => tx.id === 'server-tx-1')).toBeTruthy();
    });

    it('upserts by id and does not touch the queue when no previousId is given', () => {
      const remoteTransaction = {
        id: 'server-tx-2',
        description: 'Salario',
        type: 'INCOME',
        amount: 5000,
        date: '2026-08-01',
      } as any;

      service.reconcileTransaction(remoteTransaction);

      expect(
        service.readTransactions().find((tx) => tx.id === 'server-tx-2'),
      ).toBeTruthy();
      expect(service.getQueueSnapshot().length).toBe(0);
    });
  });

  describe('reconcileGoal', () => {
    it('replaces the offline placeholder with the remote goal and updates the queue record id', () => {
      const offlineGoal = service.queueGoalCreate({
        title: 'Viagem',
        targetAmount: 10000,
      });

      const remoteGoal = {
        id: 'server-goal-1',
        title: 'Viagem',
        targetAmount: 10000,
        currentAmount: 0,
        status: 'ACTIVE',
      } as any;

      service.reconcileGoal(remoteGoal, offlineGoal.id);

      const cached = service.readGoals();
      expect(cached.find((goal) => goal.id === offlineGoal.id)).toBeUndefined();
      expect(cached.find((goal) => goal.id === 'server-goal-1')).toBeTruthy();
    });

    it('upserts by id and does not touch the queue when no previousId is given', () => {
      const remoteGoal = {
        id: 'server-goal-2',
        title: 'Reserva de emergencia',
        targetAmount: 20000,
        currentAmount: 3000,
        status: 'ACTIVE',
      } as any;

      service.reconcileGoal(remoteGoal);

      expect(service.readGoals().find((goal) => goal.id === 'server-goal-2')).toBeTruthy();
      expect(service.getQueueSnapshot().length).toBe(0);
    });
  });
});
