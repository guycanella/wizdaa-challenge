import {
    LeaveType,
    BalanceRecord,
    FileTimeOffRequest,
    SimulateAnniversaryRequest,
    SimulateErrorModeRequest,
    SeedBalanceRequest,
  } from '../../src/schemas';
  
  describe('Schemas', () => {
    describe('LeaveType', () => {
      it('should accept valid leave types', () => {
        expect(LeaveType.parse('VACATION')).toBe('VACATION');
        expect(LeaveType.parse('SICK')).toBe('SICK');
        expect(LeaveType.parse('PERSONAL')).toBe('PERSONAL');
      });
  
      it('should reject invalid leave types', () => {
        expect(() => LeaveType.parse('HOLIDAY')).toThrow();
        expect(() => LeaveType.parse('')).toThrow();
        expect(() => LeaveType.parse(123)).toThrow();
      });
    });
  
    describe('BalanceRecord', () => {
      it('should accept a valid balance record', () => {
        const result = BalanceRecord.parse({
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'VACATION',
          totalBalance: 20,
          usedBalance: 5,
        });
        expect(result.totalBalance).toBe(20);
      });
  
      it('should reject negative balances', () => {
        expect(() =>
          BalanceRecord.parse({
            employeeId: 'EMP-001',
            locationId: 'LOC-BR-SP',
            leaveType: 'VACATION',
            totalBalance: -1,
            usedBalance: 0,
          }),
        ).toThrow();
      });
  
      it('should reject empty employeeId', () => {
        expect(() =>
          BalanceRecord.parse({
            employeeId: '',
            locationId: 'LOC-BR-SP',
            leaveType: 'VACATION',
            totalBalance: 10,
            usedBalance: 0,
          }),
        ).toThrow();
      });
    });
  
    describe('FileTimeOffRequest', () => {
      const validRequest = {
        employeeId: 'EMP-001',
        locationId: 'LOC-BR-SP',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-05',
        days: 3,
      };
  
      it('should accept a valid request', () => {
        const result = FileTimeOffRequest.parse(validRequest);
        expect(result.days).toBe(3);
      });
  
      it('should reject invalid date format', () => {
        expect(() =>
          FileTimeOffRequest.parse({ ...validRequest, startDate: '05/01/2026' }),
        ).toThrow();
      });
  
      it('should reject zero days', () => {
        expect(() =>
          FileTimeOffRequest.parse({ ...validRequest, days: 0 }),
        ).toThrow();
      });
  
      it('should reject negative days', () => {
        expect(() =>
          FileTimeOffRequest.parse({ ...validRequest, days: -1 }),
        ).toThrow();
      });
  
      it('should reject missing fields', () => {
        expect(() =>
          FileTimeOffRequest.parse({ employeeId: 'EMP-001' }),
        ).toThrow();
      });
    });
  
    describe('SimulateAnniversaryRequest', () => {
      it('should accept valid request with default leaveType', () => {
        const result = SimulateAnniversaryRequest.parse({
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          bonusDays: 5,
        });
        expect(result.leaveType).toBe('VACATION'); // default
      });
  
      it('should accept explicit leaveType', () => {
        const result = SimulateAnniversaryRequest.parse({
          employeeId: 'EMP-001',
          locationId: 'LOC-BR-SP',
          leaveType: 'SICK',
          bonusDays: 3,
        });
        expect(result.leaveType).toBe('SICK');
      });
  
      it('should reject zero bonusDays', () => {
        expect(() =>
          SimulateAnniversaryRequest.parse({
            employeeId: 'EMP-001',
            locationId: 'LOC-BR-SP',
            bonusDays: 0,
          }),
        ).toThrow();
      });
    });
  
    describe('SimulateErrorModeRequest', () => {
      it('should accept minimal request', () => {
        const result = SimulateErrorModeRequest.parse({ enabled: true });
        expect(result.errorRate).toBe(1); // default
      });
  
      it('should accept full request', () => {
        const result = SimulateErrorModeRequest.parse({
          enabled: true,
          errorType: 'timeout',
          errorRate: 0.5,
        });
        expect(result.errorType).toBe('timeout');
        expect(result.errorRate).toBe(0.5);
      });
  
      it('should reject errorRate > 1', () => {
        expect(() =>
          SimulateErrorModeRequest.parse({ enabled: true, errorRate: 1.5 }),
        ).toThrow();
      });
  
      it('should reject errorRate < 0', () => {
        expect(() =>
          SimulateErrorModeRequest.parse({ enabled: true, errorRate: -0.1 }),
        ).toThrow();
      });
  
      it('should reject invalid errorType', () => {
        expect(() =>
          SimulateErrorModeRequest.parse({ enabled: true, errorType: 'crash' }),
        ).toThrow();
      });
    });
  
    describe('SeedBalanceRequest', () => {
      it('should accept an array of balance records', () => {
        const result = SeedBalanceRequest.parse([
          { employeeId: 'EMP-001', locationId: 'LOC-BR-SP', leaveType: 'VACATION', totalBalance: 20, usedBalance: 5 },
          { employeeId: 'EMP-002', locationId: 'LOC-US-NY', leaveType: 'SICK', totalBalance: 10, usedBalance: 0 },
        ]);
        expect(result).toHaveLength(2);
      });
  
      it('should accept an empty array', () => {
        const result = SeedBalanceRequest.parse([]);
        expect(result).toHaveLength(0);
      });
  
      it('should reject invalid records in array', () => {
        expect(() =>
          SeedBalanceRequest.parse([
            { employeeId: '', locationId: 'LOC', leaveType: 'VACATION', totalBalance: 10, usedBalance: 0 },
          ]),
        ).toThrow();
      });
    });
  });