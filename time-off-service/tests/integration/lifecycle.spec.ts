import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import supertest from 'supertest';

import { buildServer as buildMockHcm } from '../../../mock-hcm/src/server';
import { HcmStore } from '../../../mock-hcm/src/store';

// App modules
import { HcmModule } from '../../src/hcm/hcm.module';
import { BalanceModule } from '../../src/balance/balance.module';
import { RequestModule } from '../../src/request/request.module';
import { SyncModule } from '../../src/sync/sync.module';
import { LeaveBalance } from '../../src/balance/balance.entity';
import { TimeOffRequest } from '../../src/request/request.entity';
import { SyncLog } from '../../src/sync/sync.entity';

describe('Time-Off Service - Integration', () => {
  let app: INestApplication;
  let mockHcm: Awaited<ReturnType<typeof buildMockHcm>>;
  let hcmStore: HcmStore;
  let dataSource: DataSource;
  const HCM_PORT = 4001;

  beforeAll(async () => {
    hcmStore = new HcmStore();
    mockHcm = await buildMockHcm({ store: hcmStore, logger: false });
    await mockHcm.listen({ port: HCM_PORT });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              hcm: {
                baseUrl: `http://localhost:${HCM_PORT}`,
                timeout: 5000,
                retryAttempts: 2,
                retryBaseDelay: 50,
              },
              sync: { enabled: false },
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [LeaveBalance, TimeOffRequest, SyncLog],
          synchronize: true,
        }),
        ScheduleModule.forRoot(),
        HcmModule,
        BalanceModule,
        RequestModule,
        SyncModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
    await mockHcm.close();
  });

  beforeEach(async () => {
    await dataSource.getRepository(TimeOffRequest).clear();
    await dataSource.getRepository(LeaveBalance).clear();
    await dataSource.getRepository(SyncLog).clear();

    hcmStore.reset();
    hcmStore.seedBalances([
      { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 0 },
      { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'SICK', totalBalance: 15, usedBalance: 0 },
      { employeeId: 'EMP-002', locationId: 'LOC-US-NY', leaveType: 'VACATION', totalBalance: 10, usedBalance: 2 },
    ]);
  });


  const createTimeOffRequest = (overrides = {}) =>
    supertest(app.getHttpServer())
      .post('/api/v1/requests')
      .send({
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        days: 3,
        reason: 'Family trip',
        ...overrides,
      });


  describe('Full lifecycle: create → approve → confirm', () => {
    it('should complete the full request lifecycle', async () => {
      const createRes = await createTimeOffRequest().expect(201);

      expect(createRes.body.status).toBe('PENDING');
      expect(createRes.body.employeeId).toBe('EMP-001');
      expect(createRes.body.days).toBe(3);
      const requestId = createRes.body.id;

      const balRes = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001/LOC-BR-SP?leaveType=VACATION')
        .expect(200);

      expect(balRes.body).toHaveLength(1);
      expect(balRes.body[0].pending).toBe(3);
      expect(balRes.body[0].available).toBe(17);

      const approveRes = await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${requestId}/approve`)
        .send({ managerNotes: 'Enjoy!' })
        .expect(200);

      expect(approveRes.body.status).toBe('CONFIRMED');
      expect(approveRes.body.hcmReferenceId).toBeDefined();
      expect(approveRes.body.managerNotes).toBe('Enjoy!');

      const balAfter = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001/LOC-BR-SP?leaveType=VACATION')
        .expect(200);

      expect(balAfter.body[0].used).toBe(3);
      expect(balAfter.body[0].pending).toBe(0);
      expect(balAfter.body[0].available).toBe(17);
    });
  });


  describe('Reject flow', () => {
    it('should reject request and release balance', async () => {
      const createRes = await createTimeOffRequest().expect(201);

      const rejectRes = await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/reject`)
        .send({ managerNotes: 'Team is busy' })
        .expect(200);

      expect(rejectRes.body.status).toBe('REJECTED');

      const balRes = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001/LOC-BR-SP?leaveType=VACATION')
        .expect(200);

      expect(balRes.body[0].pending).toBe(0);
      expect(balRes.body[0].available).toBe(20);
    });
  });


  describe('Cancel flows', () => {
    it('should cancel PENDING request and release reservation', async () => {
      const createRes = await createTimeOffRequest().expect(201);

      const cancelRes = await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/cancel`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');

      const balRes = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001/LOC-BR-SP?leaveType=VACATION')
        .expect(200);

      expect(balRes.body[0].pending).toBe(0);
      expect(balRes.body[0].available).toBe(20);
    });

    it('should cancel CONFIRMED request and reverse in HCM', async () => {
      const createRes = await createTimeOffRequest().expect(201);
      const approveRes = await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/approve`)
        .send({})
        .expect(200);

      expect(approveRes.body.status).toBe('CONFIRMED');

      const cancelRes = await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/cancel`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');

      const balRes = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001/LOC-BR-SP?leaveType=VACATION')
        .expect(200);

      expect(balRes.body[0].used).toBe(0);
      expect(balRes.body[0].available).toBe(20);
    });
  });


  describe('Balance integrity', () => {
    it('should reject request when insufficient balance', async () => {
      const res = await createTimeOffRequest({ days: 25 }).expect(409);
      expect(res.body.message).toContain('Insufficient balance');
    });

    it('should allow request for exact available balance', async () => {
      const res = await createTimeOffRequest({ days: 20 }).expect(201);
      expect(res.body.status).toBe('PENDING');
    });

    it('should reject second request that exceeds remaining balance', async () => {
      await createTimeOffRequest({ days: 15 }).expect(201);

      const res = await createTimeOffRequest({
        days: 10,
        startDate: '2026-06-01',
        endDate: '2026-06-10',
      }).expect(409);

      expect(res.body.message).toContain('Insufficient balance');
    });
  });


  describe('HCM balance drift', () => {
    it('should detect and sync anniversary bonus from HCM', async () => {
      await createTimeOffRequest({ days: 15 }).expect(201);

      hcmStore.addAnniversaryBonus('EMP-001', 'LOC-BR-SP', 'VACATION', 5);

      const res = await createTimeOffRequest({
        days: 8,
        startDate: '2026-06-01',
        endDate: '2026-06-10',
      }).expect(201);

      expect(res.body.status).toBe('PENDING');

      const balRes = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001/LOC-BR-SP?leaveType=VACATION')
        .expect(200);

      expect(balRes.body[0].total).toBe(25);
    });
  });


  describe('HCM unavailable', () => {
    it('should return 503 when HCM is down during request creation', async () => {
      hcmStore.setErrorMode({ enabled: true, errorType: '500', errorRate: 1 });

      const res = await createTimeOffRequest().expect(503);
      expect(res.body.message).toContain('HCM system is currently unavailable');
    });

    it('should return 503 when HCM is down during approval', async () => {
      const createRes = await createTimeOffRequest().expect(201);

      hcmStore.setErrorMode({ enabled: true, errorType: '500', errorRate: 1 });

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/approve`)
        .send({})
        .expect(503);

      expect(res.body.message).toContain('HCM system is currently unavailable');
    });
  });


  describe('HCM rejection during submission', () => {
    it('should mark HCM_REJECTED when HCM rejects the filing', async () => {
      const createRes = await createTimeOffRequest().expect(201);

      hcmStore.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 19 },
      ]);

      const approveRes = await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/approve`)
        .send({})
        .expect(200);

      expect(approveRes.body.status).toBe('HCM_REJECTED');
      expect(approveRes.body.hcmSubmissionError).toBeDefined();

      const balRes = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001/LOC-BR-SP?leaveType=VACATION')
        .expect(200);

      expect(balRes.body[0].pending).toBe(0);
    });
  });


  describe('Batch sync', () => {
    it('should sync all balances via manual trigger', async () => {
      await createTimeOffRequest().expect(201);

      hcmStore.seedBalances([
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 30, usedBalance: 2 },
        { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'SICK', totalBalance: 15, usedBalance: 0 },
        { employeeId: 'EMP-002', locationId: 'LOC-US-NY', leaveType: 'VACATION', totalBalance: 10, usedBalance: 2 },
      ]);

      const syncRes = await supertest(app.getHttpServer())
        .post('/api/v1/sync')
        .expect(201);

      expect(syncRes.body.status).toBe('COMPLETED');
      expect(syncRes.body.recordsProcessed).toBe(3);
      expect(syncRes.body.discrepanciesFound).toBeGreaterThan(0);

      const balRes = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001/LOC-BR-SP?leaveType=VACATION')
        .expect(200);

      expect(balRes.body[0].total).toBe(30);
    });

    it('should return sync status', async () => {
      await supertest(app.getHttpServer()).post('/api/v1/sync').expect(201);

      const statusRes = await supertest(app.getHttpServer())
        .get('/api/v1/sync/status')
        .expect(200);

      expect(statusRes.body.status).toBe('COMPLETED');
    });

    it('should return sync history', async () => {
      await supertest(app.getHttpServer()).post('/api/v1/sync').expect(201);
      await supertest(app.getHttpServer()).post('/api/v1/sync').expect(201);

      const historyRes = await supertest(app.getHttpServer())
        .get('/api/v1/sync/history')
        .expect(200);

      expect(historyRes.body.length).toBeGreaterThanOrEqual(2);
    });
  });


  describe('State machine guards', () => {
    it('should reject approving an already confirmed request', async () => {
      const createRes = await createTimeOffRequest().expect(201);

      await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/approve`)
        .send({})
        .expect(200);

      await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/approve`)
        .send({})
        .expect(400);
    });

    it('should reject cancelling an already rejected request', async () => {
      const createRes = await createTimeOffRequest().expect(201);

      await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/reject`)
        .send({ managerNotes: 'No' })
        .expect(200);

      await supertest(app.getHttpServer())
        .patch(`/api/v1/requests/${createRes.body.id}/cancel`)
        .expect(400);
    });
  });


  describe('Input validation', () => {
    it('should reject request with missing fields', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/requests')
        .send({ employeeId: 'EMP-001' })
        .expect(400);
    });

    it('should reject request with negative days', async () => {
      await createTimeOffRequest({ days: -1 }).expect(400);
    });

    it('should reject request with zero days', async () => {
      await createTimeOffRequest({ days: 0 }).expect(400);
    });

    it('should reject request with invalid date format', async () => {
      await createTimeOffRequest({ startDate: '05/01/2026' }).expect(400);
    });

    it('should reject unknown fields (whitelist)', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/requests')
        .send({
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          startDate: '2026-05-01',
          endDate: '2026-05-05',
          days: 3,
          hackerField: 'malicious',
        })
        .expect(400);
    });
  });


  describe('Query endpoints', () => {
    it('should list requests filtered by employeeId', async () => {
      await createTimeOffRequest().expect(201);
      await createTimeOffRequest({
        employeeId: 'EMP-002',
        locationId: 'LOC-US-NY',
        days: 2,
      }).expect(201);

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/requests?employeeId=EMP-001')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].employeeId).toBe('EMP-001');
    });

    it('should get request by ID', async () => {
      const createRes = await createTimeOffRequest().expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/requests/${createRes.body.id}`)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
    });

    it('should return 404 for non-existent request', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/requests/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('should get employee balances', async () => {
      await createTimeOffRequest().expect(201);

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/balances/EMP-001')
        .expect(200);

      expect(res.body.employeeId).toBe('EMP-001');
      expect(res.body.balances.length).toBeGreaterThanOrEqual(1);
    });
  });
});