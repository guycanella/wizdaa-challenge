import { Controller, Post, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { SyncService } from './sync.service';

@ApiTags('sync')
@Controller('api/v1/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post()
  @ApiOperation({ summary: 'Trigger a manual batch sync with HCM' })
  @ApiResponse({ status: 201, description: 'Sync completed' })
  @ApiResponse({ status: 500, description: 'Sync failed' })
  async triggerSync() {
    return this.syncService.triggerManualSync();
  }

  @Get('status')
  @ApiOperation({ summary: 'Get the last sync status' })
  @ApiResponse({ status: 200, description: 'Last sync log entry' })
  async getLastSyncStatus() {
    const lastSync = await this.syncService.getLastSync();
    return lastSync || { message: 'No sync has been executed yet' };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get sync history' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Sync log history' })
  async getSyncHistory(@Query('limit') limit?: number) {
    return this.syncService.getSyncHistory(limit || 10);
  }
}