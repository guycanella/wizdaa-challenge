import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BalanceService } from '../../src/balance/balance.service';
import { LeaveBalance } from '../../src/balance/balance.entity';
import { HCM_ADAPTER } from '../../src/hcm/hcm.adapter.interface';

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepo: any;
  let hcmAdapter: any;
  let dataSource: any;
  let transactionManager: any;

  const mockBalance = (overrides: Partial<LeaveBalance> = {}): LeaveBalance => {
    const bal = new LeaveBalance();
    bal.id = 'bal-uuid-1';
    bal.employeeId = 'EMP-001';
    bal.locationId = 'LOC-BR-SP';
    bal.leaveType = 'VACATION';
    bal.totalBalance = 20;
    bal.usedBalance = 5;
    bal.pendingBalance = 0;
    bal.lastSyncedAt = new Date('2026-04-16T08:00:00Z');
    bal.createdAt = new Date();
    bal.updatedAt = new Date();
    Object.assign(bal, overrides);
    return bal;
  };

  beforeEach(async () => {
    transactionManager = {
      findOne: jest.fn(),
      save: jest.fn((entity, data) => Promise.resolve(data || entity)),
    };

    dataSource = {
      transaction: jest.fn((cb: (manager: any) => Promise<any>) => cb(transactionManager)),
    };

    balanceRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((data) => {
        const bal = new LeaveBalance();
        Object.assign(bal, data);
        return bal;
      }),
      save: jest.fn((bal) => Promise.resolve(bal)),
    };

    hcmAdapter = {
      getBalance: jest.fn().mockResolvedValue({
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        totalBalance: 20,
        usedBalance: 5,
        availableBalance: 15,
      }),
      getAllBalances: jest.fn().mockResolvedValue({
        balances: [
          { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5, availableBalance: 15 },
        ],
        total: 1,
        generatedAt: '2026-04-16T08:00:00Z',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        { provide: getRepositoryToken(LeaveBalance), useValue: balanceRepo },
        { provide: HCM_ADAPTER, useValue: hcmAdapter },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
  });


  describe('getBalancesByEmployee', () => {
    it('should return all balances for an employee', async () => {
      const bal = mockBalance();
      balanceRepo.find.mockResolvedValue([bal]);

      const result = await service.getBalancesByEmployee('EMP-001');

      expect(result).toHaveLength(1);
      expect(result[0].employeeId).toBe('EMP-001');
      expect(result[0].total).toBe(20);
      expect(result[0].used).toBe(5);
      expect(result[0].pending).toBe(0);
      expect(result[0].available).toBe(15);
    });

    it('should return empty array for unknown employee', async () => {
      balanceRepo.find.mockResolvedValue([]);
      const result = await service.getBalancesByEmployee('EMP-999');
      expect(result).toHaveLength(0);
    });
  });

  describe('getBalancesAtLocation', () => {
    it('should return balances at location', async () => {
      balanceRepo.find.mockResolvedValue([mockBalance()]);

      const result = await service.getBalancesAtLocation('EMP-001', 'LOC-BR-SP');
      expect(result).toHaveLength(1);
    });

    it('should filter by leaveType when provided', async () => {
      balanceRepo.find.mockResolvedValue([mockBalance()]);

      await service.getBalancesAtLocation('EMP-001', 'LOC-BR-SP', 'VACATION');
      expect(balanceRepo.find).toHaveBeenCalledWith({
        where: { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION' },
      });
    });

    it('should throw 404 when no balances found', async () => {
      balanceRepo.find.mockResolvedValue([]);

      await expect(
        service.getBalancesAtLocation('EMP-001', 'LOC-XX'),
      ).rejects.toThrow(NotFoundException);
    });
  });


  describe('reserveBalance', () => {
    it('should increment pendingBalance within transaction', async () => {
      const bal = mockBalance({ pendingBalance: 0 });
      transactionManager.findOne.mockResolvedValue(bal);
      transactionManager.save.mockImplementation((_: any, data: any) => Promise.resolve(data));

      const result = await service.reserveBalance('EMP-001', 'LOC-BR-SP', 'VACATION', 3);

      expect(transactionManager.findOne).toHaveBeenCalledWith(
        LeaveBalance,
        expect.objectContaining({ where: { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION' } }),
      );
      expect(result.pendingBalance).toBe(3);
    });

    it('should throw NotFoundException when balance does not exist', async () => {
      transactionManager.findOne.mockResolvedValue(null);

      await expect(
        service.reserveBalance('EMP-999', 'LOC-XX', 'VACATION', 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw error when insufficient balance', async () => {
      const bal = mockBalance({ totalBalance: 10, usedBalance: 8, pendingBalance: 1 });
      transactionManager.findOne.mockResolvedValue(bal);

      await expect(
        service.reserveBalance('EMP-001', 'LOC-BR-SP', 'VACATION', 5),
      ).rejects.toThrow('Insufficient balance');
    });

    it('should allow reservation for exact available amount', async () => {
      const bal = mockBalance({ totalBalance: 10, usedBalance: 5, pendingBalance: 0 });
      transactionManager.findOne.mockResolvedValue(bal);
      transactionManager.save.mockImplementation((_: any, data: any) => Promise.resolve(data));

      const result = await service.reserveBalance('EMP-001', 'LOC-BR-SP', 'VACATION', 5);
      expect(result.pendingBalance).toBe(5);
    });
  });


  describe('releaseReservation', () => {
    it('should decrement pendingBalance', async () => {
      const bal = mockBalance({ pendingBalance: 5 });
      transactionManager.findOne.mockResolvedValue(bal);

      await service.releaseReservation('EMP-001', 'LOC-BR-SP', 'VACATION', 3);

      expect(transactionManager.save).toHaveBeenCalledWith(
        LeaveBalance,
        expect.objectContaining({ pendingBalance: 2 }),
      );
    });

    it('should not go below zero', async () => {
      const bal = mockBalance({ pendingBalance: 1 });
      transactionManager.findOne.mockResolvedValue(bal);

      await service.releaseReservation('EMP-001', 'LOC-BR-SP', 'VACATION', 5);

      expect(transactionManager.save).toHaveBeenCalledWith(
        LeaveBalance,
        expect.objectContaining({ pendingBalance: 0 }),
      );
    });

    it('should do nothing if balance not found', async () => {
      transactionManager.findOne.mockResolvedValue(null);

      await service.releaseReservation('EMP-999', 'LOC-XX', 'VACATION', 3);
      expect(transactionManager.save).not.toHaveBeenCalled();
    });
  });


  describe('confirmUsage', () => {
    it('should move days from pending to used', async () => {
      const bal = mockBalance({ pendingBalance: 3, usedBalance: 5 });
      transactionManager.findOne.mockResolvedValue(bal);

      await service.confirmUsage('EMP-001', 'LOC-BR-SP', 'VACATION', 3);

      expect(transactionManager.save).toHaveBeenCalledWith(
        LeaveBalance,
        expect.objectContaining({ pendingBalance: 0, usedBalance: 8 }),
      );
    });
  });


  describe('restoreUsage', () => {
    it('should decrement usedBalance', async () => {
      const bal = mockBalance({ usedBalance: 8 });
      transactionManager.findOne.mockResolvedValue(bal);

      await service.restoreUsage('EMP-001', 'LOC-BR-SP', 'VACATION', 3);

      expect(transactionManager.save).toHaveBeenCalledWith(
        LeaveBalance,
        expect.objectContaining({ usedBalance: 5 }),
      );
    });

    it('should not go below zero', async () => {
      const bal = mockBalance({ usedBalance: 1 });
      transactionManager.findOne.mockResolvedValue(bal);

      await service.restoreUsage('EMP-001', 'LOC-BR-SP', 'VACATION', 5);

      expect(transactionManager.save).toHaveBeenCalledWith(
        LeaveBalance,
        expect.objectContaining({ usedBalance: 0 }),
      );
    });
  });


  describe('syncBalanceFromHcm', () => {
    it('should fetch from HCM and update local balance', async () => {
      balanceRepo.findOne.mockResolvedValue(mockBalance());

      const result = await service.syncBalanceFromHcm('EMP-001', 'LOC-BR-SP', 'VACATION');

      expect(hcmAdapter.getBalance).toHaveBeenCalledWith('EMP-001', 'LOC-BR-SP', 'VACATION');
      expect(balanceRepo.save).toHaveBeenCalled();
      expect(result.totalBalance).toBe(20);
    });

    it('should create new balance if not exists locally', async () => {
      balanceRepo.findOne.mockResolvedValue(null);

      await service.syncBalanceFromHcm('EMP-001', 'LOC-BR-SP', 'VACATION');

      expect(balanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          pendingBalance: 0,
        }),
      );
    });
  });

  describe('batchSyncFromHcm', () => {
    it('should sync all balances and detect discrepancies', async () => {
      const localBalance = mockBalance({ totalBalance: 18, usedBalance: 3 }); // differs from HCM
      balanceRepo.findOne.mockResolvedValue(localBalance);

      const result = await service.batchSyncFromHcm();

      expect(result.processed).toBe(1);
      expect(result.discrepancies).toBe(1);
      expect(hcmAdapter.getAllBalances).toHaveBeenCalled();
    });

    it('should report 0 discrepancies when in sync', async () => {
      const localBalance = mockBalance({ totalBalance: 20, usedBalance: 5 });
      balanceRepo.findOne.mockResolvedValue(localBalance);

      const result = await service.batchSyncFromHcm();

      expect(result.discrepancies).toBe(0);
    });

    it('should create new balance for unknown records', async () => {
      balanceRepo.findOne.mockResolvedValue(null);

      const result = await service.batchSyncFromHcm();

      expect(result.processed).toBe(1);
      expect(result.discrepancies).toBe(0);
      expect(balanceRepo.create).toHaveBeenCalled();
    });
  });
});