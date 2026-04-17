import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server';
import { HcmStore } from '../../src/store';

describe('Mock HCM API - Integration', () => {
  let app: FastifyInstance;
  let store: HcmStore;

  beforeEach(async () => {
    store = new HcmStore();
    app = await buildServer({ store, logger: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── Helper ───────────────────────────────────────────────────

  async function seedDefaultBalances() {
    await app.inject({
      method: 'POST',
      url: '/hcm/simulate/seed',
      payload: [
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'SICK', totalBalance: 15, usedBalance: 0 },
        { employeeId: 'EMP-002', locationId: 'LOC-US-NY', leaveType: 'VACATION', totalBalance: 10, usedBalance: 2 },
      ],
    });
  }

  // ─── Health Check ─────────────────────────────────────────────

  describe('GET /hcm/health', () => {
    it('should return ok status', async () => {
      const res = await app.inject({ method: 'GET', url: '/hcm/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('mock-hcm');
    });
  });

  // ─── Balance Endpoints ────────────────────────────────────────

  describe('GET /hcm/balances/:employeeId/:locationId', () => {
    beforeEach(seedDefaultBalances);

    it('should return specific leave type balance', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/hcm/balances/EMP-001/LOC-BR-SP?leaveType=VACATION',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalBalance).toBe(20);
      expect(body.usedBalance).toBe(5);
      expect(body.availableBalance).toBe(15);
    });

    it('should return all balances at location when no leaveType specified', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/hcm/balances/EMP-001/LOC-BR-SP',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.balances).toHaveLength(2);
    });

    it('should return 404 for unknown employee', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/hcm/balances/EMP-999/LOC-BR-SP',
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 404 for unknown location', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/hcm/balances/EMP-001/LOC-XX?leaveType=VACATION',
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 400 for invalid leave type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/hcm/balances/EMP-001/LOC-BR-SP?leaveType=INVALID',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_LEAVE_TYPE');
    });
  });

  describe('GET /hcm/balances/batch', () => {
    it('should return all balances', async () => {
      await seedDefaultBalances();
      const res = await app.inject({ method: 'GET', url: '/hcm/balances/batch' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.balances).toHaveLength(3);
      expect(body.total).toBe(3);
      expect(body.generatedAt).toBeDefined();
    });

    it('should return empty array when no data', async () => {
      const res = await app.inject({ method: 'GET', url: '/hcm/balances/batch' });
      expect(res.statusCode).toBe(200);
      expect(res.json().balances).toHaveLength(0);
    });
  });

  // ─── Time-Off Endpoints ───────────────────────────────────────

  describe('POST /hcm/time-off', () => {
    beforeEach(seedDefaultBalances);

    it('should file time-off and return 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-03',
          days: 3,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.referenceId).toBeDefined();
      expect(body.status).toBe('CONFIRMED');
      expect(body.days).toBe(3);
      expect(body.newBalance.usedBalance).toBe(8);
      expect(body.newBalance.availableBalance).toBe(12);
    });

    it('should return 409 for insufficient balance', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-06-30',
          days: 50,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INSUFFICIENT_BALANCE');
    });

    it('should return 400 for invalid dimensions', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-999',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-03',
          days: 1,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_DIMENSIONS');
    });

    it('should return 400 for invalid request body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: { employeeId: 'EMP-001' }, // incomplete
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid date format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          startDate: '01/05/2026',
          endDate: '03/05/2026',
          days: 3,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should correctly deduct balance across multiple filings', async () => {
      // File 5 days
      await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
          startDate: '2026-05-01', endDate: '2026-05-05', days: 5,
        },
      });

      // File another 5 days
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
          startDate: '2026-06-01', endDate: '2026-06-05', days: 5,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.newBalance.usedBalance).toBe(15); // 5 initial + 5 + 5
      expect(body.newBalance.availableBalance).toBe(5);
    });
  });

  describe('DELETE /hcm/time-off/:referenceId', () => {
    beforeEach(seedDefaultBalances);

    it('should cancel time-off and restore balance', async () => {
      // File first
      const fileRes = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
          startDate: '2026-05-01', endDate: '2026-05-03', days: 3,
        },
      });
      const { referenceId } = fileRes.json();

      // Cancel
      const res = await app.inject({
        method: 'DELETE',
        url: `/hcm/time-off/${referenceId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('CANCELLED');
      expect(body.restoredDays).toBe(3);
      expect(body.newBalance.usedBalance).toBe(5); // back to original
    });

    it('should return 404 for non-existent reference', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/hcm/time-off/non-existent-id',
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 409 for double cancellation', async () => {
      const fileRes = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
          startDate: '2026-05-01', endDate: '2026-05-03', days: 3,
        },
      });
      const { referenceId } = fileRes.json();

      await app.inject({ method: 'DELETE', url: `/hcm/time-off/${referenceId}` });
      const res = await app.inject({ method: 'DELETE', url: `/hcm/time-off/${referenceId}` });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ALREADY_CANCELLED');
    });
  });

  // ─── Simulation Endpoints ─────────────────────────────────────

  describe('POST /hcm/simulate/seed', () => {
    it('should seed balances', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/seed',
        payload: [
          { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
        ],
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(1);
    });

    it('should return 400 for invalid seed data', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/seed',
        payload: [{ invalid: true }],
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /hcm/simulate/anniversary', () => {
    beforeEach(seedDefaultBalances);

    it('should apply anniversary bonus', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/anniversary',
        payload: {
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          bonusDays: 5,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.bonusDays).toBe(5);
      expect(body.newBalance.totalBalance).toBe(25);
      expect(body.newBalance.availableBalance).toBe(20);
    });

    it('should return 404 for unknown employee', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/anniversary',
        payload: {
          employeeId: 'EMP-999',
          locationId: 'LOC-BR-SP',
          bonusDays: 5,
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /hcm/simulate/error-mode', () => {
    it('should enable error mode', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: '500', errorRate: 1 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().config.enabled).toBe(true);
    });

    it('should disable error mode', async () => {
      // Enable first
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: '500' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().config.enabled).toBe(false);
    });
  });

  describe('POST /hcm/simulate/reset', () => {
    it('should clear all state', async () => {
      await seedDefaultBalances();

      const res = await app.inject({ method: 'POST', url: '/hcm/simulate/reset' });
      expect(res.statusCode).toBe(200);

      const batchRes = await app.inject({ method: 'GET', url: '/hcm/balances/batch' });
      expect(batchRes.json().balances).toHaveLength(0);
    });
  });

  // ─── Error Injection ──────────────────────────────────────────

  describe('Error mode integration', () => {
    beforeEach(seedDefaultBalances);

    it('should return 500 when error mode is enabled with type 500', async () => {
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: '500', errorRate: 1 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/hcm/balances/EMP-001/LOC-BR-SP?leaveType=VACATION',
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('HCM_INTERNAL_ERROR');
    });

    it('should return 400 when error mode is enabled with type 400', async () => {
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: '400', errorRate: 1 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
          startDate: '2026-05-01', endDate: '2026-05-03', days: 3,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should return 422 when error mode is validation', async () => {
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: 'validation', errorRate: 1 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/hcm/balances/batch',
      });
      expect(res.statusCode).toBe(422);
    });

    it('should not affect simulate endpoints', async () => {
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: '500', errorRate: 1 },
      });

      // Reset should still work
      const res = await app.inject({ method: 'POST', url: '/hcm/simulate/reset' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ─── End-to-End Scenario ──────────────────────────────────────

  describe('Full lifecycle scenario', () => {
    it('should handle: seed → file → anniversary → check balance → cancel → check balance', async () => {
      // 1. Seed
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/seed',
        payload: [
          { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 0 },
        ],
      });

      // 2. File 5 days
      const fileRes = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
          startDate: '2026-05-01', endDate: '2026-05-05', days: 5,
        },
      });
      expect(fileRes.statusCode).toBe(201);
      const { referenceId } = fileRes.json();

      // 3. Anniversary bonus +3
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/anniversary',
        payload: { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', bonusDays: 3 },
      });

      // 4. Check balance: total=23, used=5, available=18
      const balRes = await app.inject({
        method: 'GET',
        url: '/hcm/balances/EMP-001/LOC-BR-SP?leaveType=VACATION',
      });
      expect(balRes.json().totalBalance).toBe(23);
      expect(balRes.json().usedBalance).toBe(5);
      expect(balRes.json().availableBalance).toBe(18);

      // 5. Cancel the time-off
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/hcm/time-off/${referenceId}`,
      });
      expect(cancelRes.statusCode).toBe(200);

      // 6. Check balance: total=23, used=0, available=23
      const finalRes = await app.inject({
        method: 'GET',
        url: '/hcm/balances/EMP-001/LOC-BR-SP?leaveType=VACATION',
      });
      expect(finalRes.json().totalBalance).toBe(23);
      expect(finalRes.json().usedBalance).toBe(0);
      expect(finalRes.json().availableBalance).toBe(23);
    });
  });
});