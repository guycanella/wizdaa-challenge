import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { LeaveBalance } from './balance.entity';
import { BalanceResponseDto } from './balance.dto';
import { HCM_ADAPTER, IHcmAdapter, HcmBalanceResponse } from '../hcm/hcm.adapter.interface';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    @InjectRepository(LeaveBalance)
    private readonly balanceRepo: Repository<LeaveBalance>,
    @Inject(HCM_ADAPTER)
    private readonly hcmAdapter: IHcmAdapter,
    private readonly dataSource: DataSource,
  ) {}


  async getBalancesByEmployee(employeeId: string): Promise<BalanceResponseDto[]> {
    const balances = await this.balanceRepo.find({ where: { employeeId } });
    return balances.map(this.toResponseDto);
  }

  async getBalancesAtLocation(employeeId: string, locationId: string, leaveType?: string): Promise<BalanceResponseDto[]> {
    const where: Record<string, string> = { employeeId, locationId };
    if (leaveType) where.leaveType = leaveType;

    const balances = await this.balanceRepo.find({ where });
    if (balances.length === 0) {
      throw new NotFoundException(
        `No balances found for employee ${employeeId} at location ${locationId}`,
      );
    }
    return balances.map(this.toResponseDto);
  }


  async reserveBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): Promise<LeaveBalance> {
    return this.dataSource.transaction(async (manager) => {
      const balance = await manager.findOne(LeaveBalance, {
        where: { employeeId, locationId, leaveType },
        
      });

      if (!balance) {
        throw new NotFoundException(
          `No balance found for employee ${employeeId}, location ${locationId}, type ${leaveType}`,
        );
      }

      const available = Number(balance.totalBalance) - Number(balance.usedBalance) - Number(balance.pendingBalance);
      if (days > available) {
        throw new Error(
          `Insufficient balance. Available: ${available}, Requested: ${days}`,
        );
      }

      balance.pendingBalance = Number(balance.pendingBalance) + days;
      return manager.save(LeaveBalance, balance);
    });
  }

  async releaseReservation(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const balance = await manager.findOne(LeaveBalance, {
        where: { employeeId, locationId, leaveType },
        
      });

      if (balance) {
        balance.pendingBalance = Math.max(0, Number(balance.pendingBalance) - days);
        await manager.save(LeaveBalance, balance);
      }
    });
  }

  async confirmUsage(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const balance = await manager.findOne(LeaveBalance, {
        where: { employeeId, locationId, leaveType },
        
      });

      if (balance) {
        balance.pendingBalance = Math.max(0, Number(balance.pendingBalance) - days);
        balance.usedBalance = Number(balance.usedBalance) + days;
        await manager.save(LeaveBalance, balance);
      }
    });
  }

  async restoreUsage(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const balance = await manager.findOne(LeaveBalance, {
        where: { employeeId, locationId, leaveType },
        
      });

      if (balance) {
        balance.usedBalance = Math.max(0, Number(balance.usedBalance) - days);
        await manager.save(LeaveBalance, balance);
      }
    });
  }

  async syncBalanceFromHcm(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<LeaveBalance> {
    const hcmBalance = await this.hcmAdapter.getBalance(employeeId, locationId, leaveType);
    return this.upsertFromHcm(hcmBalance);
  }

  async batchSyncFromHcm(): Promise<{ processed: number; discrepancies: number }> {
    const response = await this.hcmAdapter.getAllBalances();
    let discrepancies = 0;

    for (const hcmBalance of response.balances) {
      const existing = await this.balanceRepo.findOne({
        where: {
          employeeId: hcmBalance.employeeId,
          locationId: hcmBalance.locationId,
          leaveType: hcmBalance.leaveType,
        },
      });

      if (existing) {
        const totalChanged = Number(existing.totalBalance) !== hcmBalance.totalBalance;
        const usedChanged = Number(existing.usedBalance) !== hcmBalance.usedBalance;

        if (totalChanged || usedChanged) {
          discrepancies++;
          this.logger.warn(
            `Balance discrepancy for ${hcmBalance.employeeId}/${hcmBalance.locationId}/${hcmBalance.leaveType}: ` +
            `local(total=${existing.totalBalance}, used=${existing.usedBalance}) vs ` +
            `hcm(total=${hcmBalance.totalBalance}, used=${hcmBalance.usedBalance})`,
          );
        }
      }

      await this.upsertFromHcm(hcmBalance);
    }

    return { processed: response.balances.length, discrepancies };
  }


  private async upsertFromHcm(hcmBalance: HcmBalanceResponse): Promise<LeaveBalance> {
    let balance = await this.balanceRepo.findOne({
      where: {
        employeeId: hcmBalance.employeeId,
        locationId: hcmBalance.locationId,
        leaveType: hcmBalance.leaveType,
      },
    });

    if (balance) {
      balance.totalBalance = hcmBalance.totalBalance;
      balance.usedBalance = hcmBalance.usedBalance;
      balance.lastSyncedAt = new Date();
    } else {
      balance = this.balanceRepo.create({
        employeeId: hcmBalance.employeeId,
        locationId: hcmBalance.locationId,
        leaveType: hcmBalance.leaveType,
        totalBalance: hcmBalance.totalBalance,
        usedBalance: hcmBalance.usedBalance,
        pendingBalance: 0,
        lastSyncedAt: new Date(),
      });
    }

    return this.balanceRepo.save(balance);
  }

  private toResponseDto(balance: LeaveBalance): BalanceResponseDto {
    return {
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      leaveType: balance.leaveType,
      total: Number(balance.totalBalance),
      used: Number(balance.usedBalance),
      pending: Number(balance.pendingBalance),
      available: Number(balance.totalBalance) - Number(balance.usedBalance) - Number(balance.pendingBalance),
      lastSyncedAt: balance.lastSyncedAt?.toISOString() || null,
    };
  }
}