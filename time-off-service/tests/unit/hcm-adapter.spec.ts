import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HcmAdapter, HcmUnavailableError, HcmValidationError } from '../../src/hcm/hcm.adapter';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HcmAdapter', () => {
  let adapter: HcmAdapter;
  let mockClient: any;

  beforeEach(async () => {
    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    };

    mockedAxios.create.mockReturnValue(mockClient as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HcmAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, any> = {
                'hcm.baseUrl': 'http://localhost:3001',
                'hcm.timeout': 5000,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    adapter = module.get<HcmAdapter>(HcmAdapter);
  });

  // ── getBalance ───────────────────────────────────────────────

  describe('getBalance', () => {
    it('should return balance from HCM', async () => {
      const hcmData = {
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        totalBalance: 20,
        usedBalance: 5,
        availableBalance: 15,
      };
      mockClient.get.mockResolvedValue({ data: hcmData });

      const result = await adapter.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION');

      expect(result).toEqual(hcmData);
      expect(mockClient.get).toHaveBeenCalledWith(
        '/hcm/balances/EMP-001/LOC-BR-SP',
        { params: { leaveType: 'VACATION' } },
      );
    });

    it('should throw HcmUnavailableError on network failure', async () => {
      const error = new axios.AxiosError('Network Error');
      error.code = 'ECONNREFUSED';
      mockClient.get.mockRejectedValue(error);

      await expect(adapter.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION'))
        .rejects.toThrow(HcmUnavailableError);
    });

    it('should throw HcmUnavailableError on timeout', async () => {
      const error = new axios.AxiosError('Timeout');
      error.code = 'ECONNABORTED';
      mockClient.get.mockRejectedValue(error);

      await expect(adapter.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION'))
        .rejects.toThrow(HcmUnavailableError);
    });

    it('should throw HcmValidationError on 4xx', async () => {
      const error = new axios.AxiosError('Not Found');
      error.response = { status: 404, data: { error: 'Not found', code: 'NOT_FOUND' } } as any;
      mockClient.get.mockRejectedValue(error);

      await expect(adapter.getBalance('EMP-001', 'LOC-XX', 'VACATION'))
        .rejects.toThrow(HcmValidationError);
    });

    it('should throw HcmUnavailableError on 5xx', async () => {
      const error = new axios.AxiosError('Server Error');
      error.response = { status: 500, data: { error: 'Internal Error', code: 'HCM_INTERNAL_ERROR' } } as any;
      mockClient.get.mockRejectedValue(error);

      await expect(adapter.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION'))
        .rejects.toThrow(HcmUnavailableError);
    });
  });

  // ── getBalancesAtLocation ────────────────────────────────────

  describe('getBalancesAtLocation', () => {
    it('should return balances array', async () => {
      mockClient.get.mockResolvedValue({
        data: {
          balances: [
            { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5, availableBalance: 15 },
          ],
        },
      });

      const result = await adapter.getBalancesAtLocation('EMP-001', 'LOC-BR-SP');
      expect(result).toHaveLength(1);
    });

    it('should handle single balance response (no balances array)', async () => {
      mockClient.get.mockResolvedValue({
        data: { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5, availableBalance: 15 },
      });

      const result = await adapter.getBalancesAtLocation('EMP-001', 'LOC-BR-SP');
      expect(result).toHaveLength(1);
    });
  });

  // ── getAllBalances ────────────────────────────────────────────

  describe('getAllBalances', () => {
    it('should return batch response', async () => {
      mockClient.get.mockResolvedValue({
        data: { balances: [], total: 0, generatedAt: '2026-04-16T08:00:00Z' },
      });

      const result = await adapter.getAllBalances();
      expect(result.total).toBe(0);
    });
  });

  // ── fileTimeOff ──────────────────────────────────────────────

  describe('fileTimeOff', () => {
    it('should file time-off successfully', async () => {
      const hcmResponse = {
        referenceId: 'hcm-ref-1',
        status: 'CONFIRMED',
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        days: 3,
        newBalance: { totalBalance: 20, usedBalance: 8, availableBalance: 12 },
      };
      mockClient.post.mockResolvedValue({ data: hcmResponse });

      const result = await adapter.fileTimeOff({
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        days: 3,
      });

      expect(result.referenceId).toBe('hcm-ref-1');
    });

    it('should throw HcmValidationError on 409 (insufficient balance)', async () => {
      const error = new axios.AxiosError('Conflict');
      error.response = { status: 409, data: { error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' } } as any;
      mockClient.post.mockRejectedValue(error);

      await expect(adapter.fileTimeOff({
        employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION',
        startDate: '2026-05-01', endDate: '2026-05-03', days: 50,
      })).rejects.toThrow(HcmValidationError);
    });
  });

  // ── cancelTimeOff ────────────────────────────────────────────

  describe('cancelTimeOff', () => {
    it('should cancel time-off successfully', async () => {
      mockClient.delete.mockResolvedValue({
        data: { referenceId: 'hcm-ref-1', status: 'CANCELLED', restoredDays: 3, newBalance: {} },
      });

      const result = await adapter.cancelTimeOff('hcm-ref-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('should throw HcmValidationError on 404 (not found)', async () => {
      const error = new axios.AxiosError('Not Found');
      error.response = { status: 404, data: { error: 'Not found', code: 'NOT_FOUND' } } as any;
      mockClient.delete.mockRejectedValue(error);

      await expect(adapter.cancelTimeOff('non-existent'))
        .rejects.toThrow(HcmValidationError);
    });
  });

  // ── Unexpected errors ────────────────────────────────────────

  describe('unexpected errors', () => {
    it('should wrap non-Axios errors as HcmUnavailableError', async () => {
      mockClient.get.mockRejectedValue(new Error('Something weird'));

      await expect(adapter.getBalance('EMP-001', 'LOC-BR-SP', 'VACATION'))
        .rejects.toThrow(HcmUnavailableError);
    });
  });
});