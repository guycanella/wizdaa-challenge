import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { BalanceService } from './balance.service';
import {
  BalanceParamsDto,
  BalanceLocationParamsDto,
  BalanceQueryDto,
  BalanceResponseDto,
  EmployeeBalancesResponseDto,
} from './balance.dto';

@ApiTags('balances')
@Controller('api/v1/balances')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get(':employeeId')
  @ApiOperation({ summary: 'Get all balances for an employee' })
  @ApiResponse({ status: 200, type: EmployeeBalancesResponseDto })
  async getEmployeeBalances(
    @Param() params: BalanceParamsDto,
  ): Promise<EmployeeBalancesResponseDto> {
    const balances = await this.balanceService.getBalancesByEmployee(params.employeeId);
    return {
      employeeId: params.employeeId,
      balances,
    };
  }

  @Get(':employeeId/:locationId')
  @ApiOperation({ summary: 'Get balances for employee at a specific location' })
  @ApiQuery({ name: 'leaveType', required: false, enum: ['VACATION', 'SICK', 'PERSONAL'] })
  @ApiResponse({ status: 200, type: [BalanceResponseDto] })
  @ApiResponse({ status: 404, description: 'No balances found' })
  async getBalancesAtLocation(
    @Param() params: BalanceLocationParamsDto,
    @Query() query: BalanceQueryDto,
  ): Promise<BalanceResponseDto[]> {
    return this.balanceService.getBalancesAtLocation(
      params.employeeId,
      params.locationId,
      query.leaveType,
    );
  }
}