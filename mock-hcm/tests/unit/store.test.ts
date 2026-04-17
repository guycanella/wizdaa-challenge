import { HcmStore } from '../../src/store';

describe('HcmStore', () => {
  let store: HcmStore;

  beforeEach(() => {
    store = new HcmStore();
  });

  // ─── Balance Key ──────────────────────────────────────────────

  describe('balanceKey', () => {
    it('should generate a consistent composite key', () => {
      const key = HcmStore.balanceKey('EMP-001', 'LOC-BR-SP', 'VACATION');
      expect(key).toBe('EMP-001:LOC-BR-SP:VACATION');
    });

    it('should produce different keys for different dimensions', () => {
      const key1 = HcmStore.balanceKey('EMP-001', 'LOC-BR-SP', 'VACATION');
      const key2 = HcmStore.balanceKey('EMP-001', 'LOC-BR-SP', 'SICK');
      const key3 = HcmStore.balanceKey('EMP-001', 'LOC-US-NY', 'VACATION');
      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  // ─── Seed & Get Balances ──────────────────────────────────────

  describe('seedBalances / getBalance', () => {
    it('should seed and retrieve a single balance', () => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
      ]);

      const balance = store.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION');
      expect(balance).not.toBeNull();
      expect(balance!.totalBalance).toBe(20);
      expect(balance!.usedBalance).toBe(5);
      expect(balance!.availableBalance).toBe(15);
    });

    it('should return null for non-existent balance', () => {
      const balance = store.getBalance('EMP-999', 'LOC-XX', 'VACATION');
      expect(balance).toBeNull();
    });

    it('should seed multiple balances for the same employee', () => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'SICK', totalBalance: 15, usedBalance: 0 },
      ]);

      const vacation = store.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION');
      const sick = store.getBalance('EMP-001', 'LOC-BR-SP', 'SICK');
      expect(vacation!.availableBalance).toBe(15);
      expect(sick!.availableBalance).toBe(15);
    });

    it('should overwrite balance when seeded with same key', () => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
      ]);
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 30, usedBalance: 10 },
      ]);

      const balance = store.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION');
      expect(balance!.totalBalance).toBe(30);
      expect(balance!.usedBalance).toBe(10);
    });
  });

  describe('getBalancesByEmployee', () => {
    it('should return all balances for an employee', () => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'SICK', totalBalance: 15, usedBalance: 0 },
        { employeeId: 'EMP-002', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 10, usedBalance: 2 },
      ]);

      const balances = store.getBalancesByEmployee('EMP-001');
      expect(balances).toHaveLength(2);
      expect(balances.map((b) => b.leaveType).sort()).toEqual(['SICK', 'VACATION']);
    });

    it('should return empty array for unknown employee', () => {
      const balances = store.getBalancesByEmployee('EMP-999');
      expect(balances).toHaveLength(0);
    });
  });

  describe('getAllBalances', () => {
    it('should return all balances in the store', () => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
        { employeeId: 'EMP-002', locationId: 'LOC-US-NY', leaveType: 'SICK', totalBalance: 10, usedBalance: 3 },
      ]);

      const all = store.getAllBalances();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when store is empty', () => {
      expect(store.getAllBalances()).toHaveLength(0);
    });
  });

  // ─── File Time-Off ────────────────────────────────────────────

  describe('fileTimeOff', () => {
    beforeEach(() => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
      ]);
    });

    it('should file time-off and deduct balance', () => {
      const result = store.fileTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 3,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.record.referenceId).toBeDefined();
      expect(result.record.days).toBe(3);
      expect(result.record.status).toBe('ACTIVE');
      expect(result.newBalance.usedBalance).toBe(8);
      expect(result.newBalance.availableBalance).toBe(12);
    });

    it('should file time-off for exact remaining balance', () => {
      const result = store.fileTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-20',
        days: 15, // exactly the available balance
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.newBalance.availableBalance).toBe(0);
    });

    it('should reject when insufficient balance', () => {
      const result = store.fileTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-06-01',
        days: 16, // 1 more than available
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('should reject for invalid dimensions (unknown employee)', () => {
      const result = store.fileTimeOff({
        employeeId: 'EMP-999',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 1,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe('INVALID_DIMENSIONS');
    });

    it('should reject for invalid dimensions (unknown leave type)', () => {
      const result = store.fileTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'SICK', // not seeded
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 1,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe('INVALID_DIMENSIONS');
    });

    it('should reject when startDate is after endDate', () => {
      const result = store.fileTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        startDate: '2026-05-10',
        endDate: '2026-05-01',
        days: 3,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe('INVALID_DATES');
    });

    it('should handle multiple sequential filings correctly', () => {
      store.fileTimeOff({
        employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
        startDate: '2026-05-01', endDate: '2026-05-05', days: 5,
      });
      store.fileTimeOff({
        employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
        startDate: '2026-06-01', endDate: '2026-06-05', days: 5,
      });

      const balance = store.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION');
      expect(balance!.usedBalance).toBe(15); // 5 + 5 + 5 (initial)
      expect(balance!.availableBalance).toBe(5);
    });

    it('should generate unique referenceIds', () => {
      const r1 = store.fileTimeOff({
        employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
        startDate: '2026-05-01', endDate: '2026-05-02', days: 1,
      });
      const r2 = store.fileTimeOff({
        employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
        startDate: '2026-06-01', endDate: '2026-06-02', days: 1,
      });

      expect(r1.success && r2.success).toBe(true);
      if (!r1.success || !r2.success) return;
      expect(r1.record.referenceId).not.toBe(r2.record.referenceId);
    });
  });

  // ─── Cancel Time-Off ──────────────────────────────────────────

  describe('cancelTimeOff', () => {
    beforeEach(() => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
      ]);
    });

    it('should cancel and restore balance', () => {
      const filed = store.fileTimeOff({
        employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
        startDate: '2026-05-01', endDate: '2026-05-03', days: 3,
      });
      expect(filed.success).toBe(true);
      if (!filed.success) return;

      const result = store.cancelTimeOff(filed.record.referenceId);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.restoredDays).toBe(3);
      expect(result.newBalance.usedBalance).toBe(5); // back to original
      expect(result.newBalance.availableBalance).toBe(15);
    });

    it('should reject cancellation of non-existent record', () => {
      const result = store.cancelTimeOff('non-existent-id');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should reject double cancellation', () => {
      const filed = store.fileTimeOff({
        employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
        startDate: '2026-05-01', endDate: '2026-05-03', days: 3,
      });
      expect(filed.success).toBe(true);
      if (!filed.success) return;

      store.cancelTimeOff(filed.record.referenceId);
      const result = store.cancelTimeOff(filed.record.referenceId);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe('ALREADY_CANCELLED');
    });

    it('should not let usedBalance go below zero on cancel', () => {
      // Seed with 0 used, file 3, then manually set usedBalance to 1, then cancel 3
      store.seedBalances([
        { employeeId: 'EMP-002', locationId: 'LOC-X', leaveType: 'VACATION', totalBalance: 10, usedBalance: 0 },
      ]);
      const filed = store.fileTimeOff({
        employeeId: 'EMP-002', locationId: 'LOC-X', leaveType: 'VACATION',
        startDate: '2026-05-01', endDate: '2026-05-03', days: 3,
      });
      expect(filed.success).toBe(true);
      if (!filed.success) return;

      // Simulate HCM externally reducing usedBalance (e.g., correction)
      store.seedBalances([
        { employeeId: 'EMP-002', locationId: 'LOC-X', leaveType: 'VACATION', totalBalance: 10, usedBalance: 1 },
      ]);

      const result = store.cancelTimeOff(filed.record.referenceId);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.newBalance.usedBalance).toBe(0); // clamped to 0
    });
  });

  // ─── Anniversary Bonus ────────────────────────────────────────

  describe('addAnniversaryBonus', () => {
    it('should increase totalBalance', () => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
      ]);

      const result = store.addAnniversaryBonus('EMP-001', 'LOC-BR-SP', 'VACATION', 5);
      expect(result).not.toBeNull();
      expect(result!.totalBalance).toBe(25);
      expect(result!.availableBalance).toBe(20);
    });

    it('should return null for non-existent balance', () => {
      const result = store.addAnniversaryBonus('EMP-999', 'LOC-X', 'VACATION', 5);
      expect(result).toBeNull();
    });
  });

  // ─── Error Mode ───────────────────────────────────────────────

  describe('errorMode', () => {
    it('should default to disabled', () => {
      expect(store.errorMode.enabled).toBe(false);
    });

    it('should not trigger errors when disabled', () => {
      // Run 100 times to be sure
      for (let i = 0; i < 100; i++) {
        expect(store.shouldError()).toBe(false);
      }
    });

    it('should always trigger errors when enabled with rate 1', () => {
      store.setErrorMode({ enabled: true, errorType: '500', errorRate: 1 });
      for (let i = 0; i < 20; i++) {
        expect(store.shouldError()).toBe(true);
      }
    });

    it('should never trigger errors when enabled with rate 0', () => {
      store.setErrorMode({ enabled: true, errorType: '500', errorRate: 0 });
      for (let i = 0; i < 100; i++) {
        expect(store.shouldError()).toBe(false);
      }
    });

    it('should return a copy of error mode (immutable)', () => {
      const mode = store.errorMode;
      mode.enabled = true;
      expect(store.errorMode.enabled).toBe(false); // original unchanged
    });
  });

  // ─── Reset ────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all state', () => {
      store.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
      ]);
      store.setErrorMode({ enabled: true, errorType: '500', errorRate: 1 });

      store.reset();

      expect(store.getAllBalances()).toHaveLength(0);
      expect(store.errorMode.enabled).toBe(false);
      expect(store.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION')).toBeNull();
    });
  });
});