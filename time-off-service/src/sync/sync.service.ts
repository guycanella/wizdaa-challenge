import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SyncLog, SyncType, SyncStatus } from './sync.entity';
import { BalanceService } from '../balance/balance.service';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly syncEnabled: boolean;

  constructor(
    @InjectRepository(SyncLog)
    private readonly syncLogRepo: Repository<SyncLog>,
    private readonly balanceService: BalanceService,
    private readonly configService: ConfigService,
  ) {
    this.syncEnabled = this.configService.get<boolean>('sync.enabled', true);
  }


  @Cron(CronExpression.EVERY_6_HOURS)
  async handleScheduledSync(): Promise<void> {
    if (!this.syncEnabled) {
      this.logger.debug('Scheduled sync is disabled, skipping');
      return;
    }

    this.logger.log('Starting scheduled batch sync...');
    await this.executeBatchSync(SyncType.BATCH);
  }


  async triggerManualSync(): Promise<SyncLog> {
    this.logger.log('Starting manual batch sync...');
    return this.executeBatchSync(SyncType.MANUAL);
  }


  async getLastSync(): Promise<SyncLog | null> {
    return this.syncLogRepo.findOne({
      where: {},
      order: { startedAt: 'DESC' },
    });
  }

  async getSyncHistory(limit: number = 10): Promise<SyncLog[]> {
    return this.syncLogRepo.find({
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }


  private async executeBatchSync(syncType: SyncType): Promise<SyncLog> {
    const log = this.syncLogRepo.create({
      syncType,
      status: SyncStatus.STARTED,
      recordsProcessed: 0,
      discrepanciesFound: 0,
    });
    const savedLog = await this.syncLogRepo.save(log);

    try {
      const result = await this.balanceService.batchSyncFromHcm();

      savedLog.status = SyncStatus.COMPLETED;
      savedLog.recordsProcessed = result.processed;
      savedLog.discrepanciesFound = result.discrepancies;
      savedLog.completedAt = new Date();

      if (result.discrepancies > 0) {
        savedLog.details = `Found ${result.discrepancies} discrepancies out of ${result.processed} records`;
        this.logger.warn(savedLog.details);
      } else {
        this.logger.log(`Batch sync completed: ${result.processed} records, no discrepancies`);
      }

      return this.syncLogRepo.save(savedLog);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      savedLog.status = SyncStatus.FAILED;
      savedLog.completedAt = new Date();
      savedLog.details = `Sync failed: ${errorMessage}`;

      this.logger.error(`Batch sync failed: ${errorMessage}`);

      return this.syncLogRepo.save(savedLog);
    }
  }
}