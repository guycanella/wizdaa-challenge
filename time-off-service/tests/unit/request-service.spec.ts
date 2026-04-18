import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { RequestService } from '../../src/request/request.service';
import { TimeOffRequest, RequestStatus } from '../../src/request/request.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { HCM_ADAPTER } from '../../src/hcm/hcm.adapter.interface';
import { HcmUnavailableError, HcmValidationError } from '../../src/hcm/hcm.adapter';
import { LeaveBalance } from '../../src/balance/balance.entity';

describe('RequestService', () => {
  let service: RequestService;
  let requestRepo: any;
  let balanceService: any;
  let hcmAdapter: any;

  const mockRequest = (): TimeOffRequest => {
    const req = new TimeOffRequest();
    req.id = 'req-uuid-1';
    req.employeeId = 'EMP-001';
    req.locationId = 'LOC-BR-SP';
    req.leaveType = 'VACATION';
    req.startDate = '2026-05-01';
    req.endDate = '2026-05-05';
    req.days = 3;
    req.status = RequestStatus.PENDING;
    req.retryCount = 0;
    req.createdAt = new Date('2026-04-16T10:00:00Z');
    req.updatedAt = new Date('2026-04-16T10:00:00Z');
    return req;
  };

  const mockBalance = (): LeaveBalance => {
    const bal = new LeaveBalance();
    bal.id = 'bal-uuid-1';
    bal.employeeId = 'EMP-001';
    bal.locationId = 'LOC-BR-SP';
    bal.leaveType = 'VACATION';
    bal.totalBalance = 20;
    bal.usedBalance = 5;
    bal.pendingBalance = 0;
    bal.lastSyncedAt = new Date();
    bal.createdAt = new Date();
    bal.updatedAt = new Date();
    return bal;
  };

  beforeEach(async () => {
    requestRepo = {
      create: jest.fn((data) => {
        const req = mockRequest();
        Object.assign(req, data);
        return req;
      }),
      save: jest.fn((req) => Promise.resolve({ ...req, id: req.id || 'req-uuid-new' })),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    balanceService = {
      syncBalanceFromHcm: jest.fn().mockResolvedValue(mockBalance()),
      reserveBalance: jest.fn().mockResolvedValue(mockBalance()),
      releaseReservation: jest.fn().mockResolvedValue(undefined),
      confirmUsage: jest.fn().mockResolvedValue(undefined),
      restoreUsage: jest.fn().mockResolvedValue(undefined),
    };

    hcmAdapter = {
      fileTimeOff: jest.fn().mockResolvedValue({
        referenceId: 'hcm-ref-1',
        status: 'CONFIRMED',
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        days: 3,
        newBalance: { totalBalance: 20, usedBalance: 8, availableBalance: 12 },
      }),
      cancelTimeOff: jest.fn().mockResolvedValue({
        referenceId: 'hcm-ref-1',
        status: 'CANCELLED',
        restoredDays: 3,
        newBalance: { totalBalance: 20, usedBalance: 5, availableBalance: 15 },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestService,
        { provide: getRepositoryToken(TimeOffRequest), useValue: requestRepo },
        { provide: BalanceService, useValue: balanceService },
        { provide: HCM_ADAPTER, useValue: hcmAdapter },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                'hcm.retryAttempts': 2,
                'hcm.retryBaseDelay': 10, // fast for tests
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RequestService>(RequestService);
  });

  // ── Create Request ───────────────────────────────────────────

  describe('createRequest', () => {
    const dto = {
      employeeId: 'EMP-001',
      locationId: 'LOC-BR-SP',
      leaveType: 'VACATION',
      startDate: '2026-05-01',
      endDate: '2026-05-05',
      days: 3,
      reason: 'Family trip',
    };

    it('should create a PENDING request after HCM sync and balance reservation', async () => {
      const result = await service.createRequest(dto);

      expect(balanceService.syncBalanceFromHcm).toHaveBeenCalledWith('EMP-001', 'LOC-BR-SP', 'VACATION');
      expect(balanceService.reserveBalance).toHaveBeenCalledWith('EMP-001', 'LOC-BR-SP', 'VACATION', 3);
      expect(requestRepo.save).toHaveBeenCalled();
      expect(result.status).toBe(RequestStatus.PENDING);
    });

    it('should throw 503 when HCM is unavailable', async () => {
      balanceService.syncBalanceFromHcm.mockRejectedValue(new HcmUnavailableError('HCM down'));

      await expect(service.createRequest(dto)).rejects.toThrow(ServiceUnavailableException);
      expect(balanceService.reserveBalance).not.toHaveBeenCalled();
    });

    it('should throw 409 when insufficient balance', async () => {
      balanceService.reserveBalance.mockRejectedValue(new Error('Insufficient balance. Available: 2, Requested: 3'));

      await expect(service.createRequest(dto)).rejects.toThrow(ConflictException);
    });

    it('should throw 400 when startDate > endDate', async () => {
      await expect(
        service.createRequest({ ...dto, startDate: '2026-05-10', endDate: '2026-05-01' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Approve Request ──────────────────────────────────────────

  describe('approveRequest', () => {
    it('should approve, submit to HCM, and return CONFIRMED', async () => {
      const req = mockRequest();
      req.status = RequestStatus.PENDING;
      requestRepo.findOne.mockResolvedValue(req);

      const result = await service.approveRequest('req-uuid-1', 'Approved!');

      expect(balanceService.syncBalanceFromHcm).toHaveBeenCalled();
      expect(hcmAdapter.fileTimeOff).toHaveBeenCalled();
      expect(balanceService.confirmUsage).toHaveBeenCalled();
      expect(result.status).toBe(RequestStatus.CONFIRMED);
      expect(result.hcmReferenceId).toBe('hcm-ref-1');
    });

    it('should throw 503 when HCM is down during approval', async () => {
      const req = mockRequest();
      req.status = RequestStatus.PENDING;
      requestRepo.findOne.mockResolvedValue(req);
      balanceService.syncBalanceFromHcm.mockRejectedValue(new HcmUnavailableError('HCM down'));

      await expect(service.approveRequest('req-uuid-1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw 400 when trying to approve a non-PENDING request', async () => {
      const req = mockRequest();
      req.status = RequestStatus.CONFIRMED;
      requestRepo.findOne.mockResolvedValue(req);

      await expect(service.approveRequest('req-uuid-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw 404 for non-existent request', async () => {
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.approveRequest('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── HCM Submission Retry Logic ───────────────────────────────

  describe('approveRequest - HCM submission retry', () => {
    it('should retry on HcmUnavailableError and succeed on second attempt', async () => {
      const req = mockRequest();
      req.status = RequestStatus.PENDING;
      requestRepo.findOne.mockResolvedValue(req);

      hcmAdapter.fileTimeOff
        .mockRejectedValueOnce(new HcmUnavailableError('timeout'))
        .mockResolvedValueOnce({
          referenceId: 'hcm-ref-2',
          status: 'CONFIRMED',
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          days: 3,
          newBalance: { totalBalance: 20, usedBalance: 8, availableBalance: 12 },
        });

      const result = await service.approveRequest('req-uuid-1');

      expect(hcmAdapter.fileTimeOff).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(RequestStatus.CONFIRMED);
    });

    it('should mark HCM_REJECTED after all retries exhausted', async () => {
      const req = mockRequest();
      req.status = RequestStatus.PENDING;
      requestRepo.findOne.mockResolvedValue(req);

      hcmAdapter.fileTimeOff.mockRejectedValue(new HcmUnavailableError('always failing'));

      const result = await service.approveRequest('req-uuid-1');

      expect(hcmAdapter.fileTimeOff).toHaveBeenCalledTimes(2); // maxRetries = 2
      expect(result.status).toBe(RequestStatus.HCM_REJECTED);
      expect(result.hcmSubmissionError).toContain('HCM unavailable after 2 attempts');
      expect(balanceService.releaseReservation).toHaveBeenCalled();
    });

    it('should not retry on HcmValidationError (4xx)', async () => {
      const req = mockRequest();
      req.status = RequestStatus.PENDING;
      requestRepo.findOne.mockResolvedValue(req);

      hcmAdapter.fileTimeOff.mockRejectedValue(
        new HcmValidationError('Insufficient balance', 'INSUFFICIENT_BALANCE', 409),
      );

      const result = await service.approveRequest('req-uuid-1');

      expect(hcmAdapter.fileTimeOff).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(RequestStatus.HCM_REJECTED);
      expect(result.hcmSubmissionError).toContain('INSUFFICIENT_BALANCE');
      expect(balanceService.releaseReservation).toHaveBeenCalled();
    });
  });

  // ── Reject Request ───────────────────────────────────────────

  describe('rejectRequest', () => {
    it('should reject and release reservation', async () => {
      const req = mockRequest();
      req.status = RequestStatus.PENDING;
      requestRepo.findOne.mockResolvedValue(req);

      const result = await service.rejectRequest('req-uuid-1', 'Team busy');

      expect(result.status).toBe(RequestStatus.REJECTED);
      expect(result.managerNotes).toBe('Team busy');
      expect(balanceService.releaseReservation).toHaveBeenCalledWith('EMP-001', 'LOC-BR-SP', 'VACATION', 3);
    });

    it('should throw 400 for non-PENDING request', async () => {
      const req = mockRequest();
      req.status = RequestStatus.CONFIRMED;
      requestRepo.findOne.mockResolvedValue(req);

      await expect(service.rejectRequest('req-uuid-1', 'No')).rejects.toThrow(BadRequestException);
    });
  });

  // ── Cancel Request ───────────────────────────────────────────

  describe('cancelRequest', () => {
    it('should cancel PENDING request and release reservation', async () => {
      const req = mockRequest();
      req.status = RequestStatus.PENDING;
      requestRepo.findOne.mockResolvedValue(req);

      const result = await service.cancelRequest('req-uuid-1');

      expect(result.status).toBe(RequestStatus.CANCELLED);
      expect(balanceService.releaseReservation).toHaveBeenCalled();
      expect(hcmAdapter.cancelTimeOff).not.toHaveBeenCalled();
    });

    it('should cancel CONFIRMED request and reverse in HCM', async () => {
      const req = mockRequest();
      req.status = RequestStatus.CONFIRMED;
      req.hcmReferenceId = 'hcm-ref-1';
      requestRepo.findOne.mockResolvedValue(req);

      const result = await service.cancelRequest('req-uuid-1');

      expect(result.status).toBe(RequestStatus.CANCELLED);
      expect(hcmAdapter.cancelTimeOff).toHaveBeenCalledWith('hcm-ref-1');
      expect(balanceService.restoreUsage).toHaveBeenCalledWith('EMP-001', 'LOC-BR-SP', 'VACATION', 3);
    });

    it('should throw 503 when cancelling CONFIRMED but HCM is down', async () => {
      const req = mockRequest();
      req.status = RequestStatus.CONFIRMED;
      req.hcmReferenceId = 'hcm-ref-1';
      requestRepo.findOne.mockResolvedValue(req);

      hcmAdapter.cancelTimeOff.mockRejectedValue(new HcmUnavailableError('HCM down'));

      await expect(service.cancelRequest('req-uuid-1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw 400 for terminal state (REJECTED)', async () => {
      const req = mockRequest();
      req.status = RequestStatus.REJECTED;
      requestRepo.findOne.mockResolvedValue(req);

      await expect(service.cancelRequest('req-uuid-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── Query ────────────────────────────────────────────────────

  describe('getRequestById', () => {
    it('should return request by ID', async () => {
      const req = mockRequest();
      requestRepo.findOne.mockResolvedValue(req);

      const result = await service.getRequestById('req-uuid-1');
      expect(result.id).toBe('req-uuid-1');
    });

    it('should throw 404 for non-existent request', async () => {
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.getRequestById('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRequests', () => {
    it('should return filtered requests', async () => {
      const req = mockRequest();
      requestRepo.find.mockResolvedValue([req]);

      const result = await service.getRequests({ employeeId: 'EMP-001' });
      expect(result).toHaveLength(1);
      expect(requestRepo.find).toHaveBeenCalledWith({
        where: { employeeId: 'EMP-001' },
        order: { createdAt: 'DESC' },
      });
    });

    it('should return all requests when no filters', async () => {
      requestRepo.find.mockResolvedValue([]);
      await service.getRequests({});
      expect(requestRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
      });
    });
  });
});