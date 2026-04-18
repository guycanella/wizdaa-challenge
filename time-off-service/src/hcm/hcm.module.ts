import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HcmAdapter } from './hcm.adapter';
import { HCM_ADAPTER } from './hcm.adapter.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: HCM_ADAPTER,
      useClass: HcmAdapter,
    },
  ],
  exports: [HCM_ADAPTER],
})
export class HcmModule {}