import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { LeaveBalance } from './balance/balance.entity';
import { TimeOffRequest } from './request/request.entity';
import { SyncLog } from './sync/sync.entity';
import { HcmModule } from './hcm/hcm.module';
import { BalanceModule } from './balance/balance.module';
import { RequestModule } from './request/request.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH || 'time-off.sqlite',
      entities: [LeaveBalance, TimeOffRequest, SyncLog],
      synchronize: true,
    }),
    ScheduleModule.forRoot(),
    HcmModule,
    BalanceModule,
    RequestModule,
    SyncModule,
  ],
})
export class AppModule {}