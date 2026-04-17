import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server';
import { HcmStore } from '../../src/store';

describe('Mock HCM API - Simulate Edge Cases', () => {
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

  // ─── Simulate Anniversary Validation ──────────────────────────

  describe('POST /hcm/simulate/anniversary - validation', () => {
    it('should return 400 for missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/anniversary',
        payload: { employeeId: 'EMP-001' }, // missing locationId and bonusDays
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for negative bonusDays', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/anniversary',
        payload: {
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          bonusDays: -5,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── Simulate Error Mode Validation ───────────────────────────

  describe('POST /hcm/simulate/error-mode - validation', () => {
    it('should return 400 for missing enabled field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { errorType: '500' }, // missing enabled
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid errorType', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: 'crash' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── Error Mode on DELETE ─────────────────────────────────────

  describe('Error mode on DELETE /hcm/time-off', () => {
    it('should return 500 on DELETE when error mode is enabled', async () => {
      // Seed and file a time-off first
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/seed',
        payload: [
          { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 0 },
        ],
      });

      const fileRes = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
          startDate: '2026-05-01', endDate: '2026-05-03', days: 3,
        },
      });
      const { referenceId } = fileRes.json();

      // Enable error mode
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: '500', errorRate: 1 },
      });

      // Try to cancel — should get error
      const res = await app.inject({
        method: 'DELETE',
        url: `/hcm/time-off/${referenceId}`,
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('HCM_INTERNAL_ERROR');
    });
  });

  // ─── Error Mode on POST time-off ─────────────────────────────

  describe('Error mode with validation type on POST /hcm/time-off', () => {
    it('should return 422 when error mode is validation', async () => {
      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/seed',
        payload: [
          { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 0 },
        ],
      });

      await app.inject({
        method: 'POST',
        url: '/hcm/simulate/error-mode',
        payload: { enabled: true, errorType: 'validation', errorRate: 1 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/hcm/time-off',
        payload: {
          employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
          startDate: '2026-05-01', endDate: '2026-05-03', days: 3,
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('HCM_VALIDATION_ERROR');
    });
  });
});