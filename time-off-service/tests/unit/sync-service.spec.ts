import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SyncService } from '../../src/sync/sync.service';
import { SyncLog, SyncType, SyncStatus } from '../../src/sync/sync.entity';
import { BalanceService } from '../../src/balance/balance.service';

describe('SyncService', () => {
  let service: SyncService;
  let syncLogRepo: any;
  let balanceService: any;

  const mockSyncLog = (overrides: Partial<SyncLog> = {}): SyncLog => {
    const log = new SyncLog();
    log.id = 'sync-uuid-1';
    log.syncType = SyncType.BATCH;
    log.status = SyncStatus.STARTED;
    log.recordsProcessed = 0;
    log.discrepanciesFound = 0;
    log.startedAt = new Date('2026-04-16T08:00:00Z');
    Object.assign(log, overrides);
    return log;
  };

  beforeEach(async () => {
    syncLogRepo = {
      create: jest.fn((data) => {
        const log = mockSyncLog();
        Object.assign(log, data);
        return log;
      }),
      save: jest.fn((log) => Promise.resolve({ ...log })),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    balanceService = {
      batchSyncFromHcm: jest.fn().mockResolvedValue({ processed: 10, discrepancies: 2 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: getRepositoryToken(SyncLog), useValue: syncLogRepo },
        { provide: BalanceService, useValue: balanceService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = { 'sync.enabled': true };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
  });

  // ── Manual Sync ──────────────────────────────────────────────

  describe('triggerManualSync', () => {
    it('should execute batch sync and return completed log', async () => {
      const result = await service.triggerManualSync();

      expect(balanceService.batchSyncFromHcm).toHaveBeenCalled();
      expect(syncLogRepo.save).toHaveBeenCalledTimes(2); // STARTED + COMPLETED
      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.syncType).toBe(SyncType.MANUAL);
      expect(result.recordsProcessed).toBe(10);
      expect(result.discrepanciesFound).toBe(2);
      expect(result.completedAt).toBeDefined();
    });

    it('should log details when discrepancies found', async () => {
      const result = await service.triggerManualSync();

      expect(result.details).toContain('2 discrepancies');
      expect(result.details).toContain('10 records');
    });

    it('should not include details when no discrepancies', async () => {
      balanceService.batchSyncFromHcm.mockResolvedValue({ processed: 5, discrepancies: 0 });

      const result = await service.triggerManualSync();

      expect(result.details).toBeUndefined();
    });

    it('should mark FAILED when batchSync throws', async () => {
      balanceService.batchSyncFromHcm.mockRejectedValue(new Error('HCM exploded'));

      const result = await service.triggerManualSync();

      expect(result.status).toBe(SyncStatus.FAILED);
      expect(result.details).toContain('HCM exploded');
      expect(result.completedAt).toBeDefined();
    });
  });

  // ── Scheduled Sync ───────────────────────────────────────────

  describe('handleScheduledSync', () => {
    it('should execute batch sync when enabled', async () => {
      await service.handleScheduledSync();

      expect(balanceService.batchSyncFromHcm).toHaveBeenCalled();
      expect(syncLogRepo.save).toHaveBeenCalled();
    });

    it('should skip when sync is disabled', async () => {
      // Recreate with disabled sync
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SyncService,
          { provide: getRepositoryToken(SyncLog), useValue: syncLogRepo },
          { provide: BalanceService, useValue: balanceService },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue?: any) => {
                if (key === 'sync.enabled') return false;
                return defaultValue;
              }),
            },
          },
        ],
      }).compile();

      const disabledService = module.get<SyncService>(SyncService);
      await disabledService.handleScheduledSync();

      expect(balanceService.batchSyncFromHcm).not.toHaveBeenCalled();
    });
  });

  // ── Query ────────────────────────────────────────────────────

  describe('getLastSync', () => {
    it('should return the most recent sync log', async () => {
      const log = mockSyncLog({ status: SyncStatus.COMPLETED });
      syncLogRepo.findOne.mockResolvedValue(log);

      const result = await service.getLastSync();

      expect(result).toBeDefined();
      expect(result!.status).toBe(SyncStatus.COMPLETED);
      expect(syncLogRepo.findOne).toHaveBeenCalledWith({
        where: {},
        order: { startedAt: 'DESC' },
      });
    });

    it('should return null when no syncs exist', async () => {
      syncLogRepo.findOne.mockResolvedValue(null);
      const result = await service.getLastSync();
      expect(result).toBeNull();
    });
  });

  describe('getSyncHistory', () => {
    it('should return sync history with default limit', async () => {
      syncLogRepo.find.mockResolvedValue([mockSyncLog()]);

      const result = await service.getSyncHistory();

      expect(result).toHaveLength(1);
      expect(syncLogRepo.find).toHaveBeenCalledWith({
        order: { startedAt: 'DESC' },
        take: 10,
      });
    });

    it('should respect custom limit', async () => {
      await service.getSyncHistory(5);

      expect(syncLogRepo.find).toHaveBeenCalledWith({
        order: { startedAt: 'DESC' },
        take: 5,
      });
    });
  });
});