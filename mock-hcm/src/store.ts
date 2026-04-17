import { BalanceRecord, BalanceResponse, LeaveType } from './schemas';
import { randomUUID } from 'crypto';

export interface TimeOffRecord {
  referenceId: string;
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: 'ACTIVE' | 'CANCELLED';
  filedAt: string;
}

export interface ErrorMode {
  enabled: boolean;
  errorType: 'timeout' | '500' | '400' | 'validation';
  errorRate: number;
}


export class HcmStore {
  private balances: Map<string, BalanceRecord> = new Map();
  private timeOffRecords: Map<string, TimeOffRecord> = new Map();
  private _errorMode: ErrorMode = { enabled: false, errorType: '500', errorRate: 1 };


  static balanceKey(employeeId: string, locationId: string, leaveType: string): string {
    return `${employeeId}:${locationId}:${leaveType}`;
  }


  get errorMode(): ErrorMode {
    return { ...this._errorMode };
  }

  setErrorMode(mode: ErrorMode): void {
    this._errorMode = { ...mode };
  }

  shouldError(): boolean {
    if (!this._errorMode.enabled) return false;
    return Math.random() < this._errorMode.errorRate;
  }


  seedBalances(records: BalanceRecord[]): void {
    for (const record of records) {
      const key = HcmStore.balanceKey(record.employeeId, record.locationId, record.leaveType);
      this.balances.set(key, { ...record });
    }
  }

  getBalance(employeeId: string, locationId: string, leaveType: string): BalanceResponse | null {
    const key = HcmStore.balanceKey(employeeId, locationId, leaveType);
    const record = this.balances.get(key);
    if (!record) return null;
    return {
      ...record,
      availableBalance: record.totalBalance - record.usedBalance,
    };
  }

  getBalancesByEmployee(employeeId: string): BalanceResponse[] {
    const results: BalanceResponse[] = [];
    for (const record of this.balances.values()) {
      if (record.employeeId === employeeId) {
        results.push({
          ...record,
          availableBalance: record.totalBalance - record.usedBalance,
        });
      }
    }
    return results;
  }

  getAllBalances(): BalanceResponse[] {
    return Array.from(this.balances.values()).map((record) => ({
      ...record,
      availableBalance: record.totalBalance - record.usedBalance,
    }));
  }


  fileTimeOff(params: {
    employeeId: string;
    locationId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
  }): { success: true; record: TimeOffRecord; newBalance: BalanceResponse } | { success: false; error: string; code: string } {
    const key = HcmStore.balanceKey(params.employeeId, params.locationId, params.leaveType);
    const balance = this.balances.get(key);

    if (!balance) {
      return {
        success: false,
        error: 'No balance found for the given employee, location, and leave type combination',
        code: 'INVALID_DIMENSIONS',
      };
    }

    const available = balance.totalBalance - balance.usedBalance;
    if (params.days > available) {
      return {
        success: false,
        error: `Insufficient balance. Available: ${available}, Requested: ${params.days}`,
        code: 'INSUFFICIENT_BALANCE',
      };
    }

    if (params.startDate > params.endDate) {
      return {
        success: false,
        error: 'Start date must be before or equal to end date',
        code: 'INVALID_DATES',
      };
    }

    balance.usedBalance += params.days;
    this.balances.set(key, balance);

    const record: TimeOffRecord = {
      referenceId: randomUUID(),
      employeeId: params.employeeId,
      locationId: params.locationId,
      leaveType: params.leaveType as LeaveType,
      startDate: params.startDate,
      endDate: params.endDate,
      days: params.days,
      status: 'ACTIVE',
      filedAt: new Date().toISOString(),
    };
    this.timeOffRecords.set(record.referenceId, record);

    return {
      success: true,
      record,
      newBalance: {
        ...balance,
        availableBalance: balance.totalBalance - balance.usedBalance,
      },
    };
  }

  cancelTimeOff(referenceId: string): { success: true; record: TimeOffRecord; restoredDays: number; newBalance: BalanceResponse } | { success: false; error: string; code: string } {
    const record = this.timeOffRecords.get(referenceId);

    if (!record) {
      return {
        success: false,
        error: 'Time-off record not found',
        code: 'NOT_FOUND',
      };
    }

    if (record.status === 'CANCELLED') {
      return {
        success: false,
        error: 'Time-off record is already cancelled',
        code: 'ALREADY_CANCELLED',
      };
    }

    const key = HcmStore.balanceKey(record.employeeId, record.locationId, record.leaveType);
    const balance = this.balances.get(key);

    if (balance) {
      balance.usedBalance = Math.max(0, balance.usedBalance - record.days);
      this.balances.set(key, balance);
    }

    record.status = 'CANCELLED';
    this.timeOffRecords.set(referenceId, record);

    const updatedBalance = balance
      ? { ...balance, availableBalance: balance.totalBalance - balance.usedBalance }
      : { employeeId: record.employeeId, locationId: record.locationId, leaveType: record.leaveType, totalBalance: 0, usedBalance: 0, availableBalance: 0 };

    return {
      success: true,
      record,
      restoredDays: record.days,
      newBalance: updatedBalance,
    };
  }


  addAnniversaryBonus(employeeId: string, locationId: string, leaveType: string, bonusDays: number): BalanceResponse | null {
    const key = HcmStore.balanceKey(employeeId, locationId, leaveType);
    const balance = this.balances.get(key);

    if (!balance) return null;

    balance.totalBalance += bonusDays;
    this.balances.set(key, balance);

    return {
      ...balance,
      availableBalance: balance.totalBalance - balance.usedBalance,
    };
  }


  reset(): void {
    this.balances.clear();
    this.timeOffRecords.clear();
    this._errorMode = { enabled: false, errorType: '500', errorRate: 1 };
  }
}

export const store = new HcmStore();