import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LeaveTypeEnum {
  VACATION = 'VACATION',
  SICK = 'SICK',
  PERSONAL = 'PERSONAL',
}

export class BalanceParamsDto {
  @ApiProperty({ example: 'EMP-001' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;
}

export class BalanceLocationParamsDto extends BalanceParamsDto {
  @ApiProperty({ example: 'LOC-BR-SP' })
  @IsString()
  @IsNotEmpty()
  locationId!: string;
}

export class BalanceQueryDto {
  @ApiPropertyOptional({ enum: LeaveTypeEnum })
  @IsOptional()
  @IsEnum(LeaveTypeEnum)
  leaveType?: LeaveTypeEnum;
}

export class BalanceResponseDto {
  @ApiProperty() employeeId!: string;
  @ApiProperty() locationId!: string;
  @ApiProperty() leaveType!: string;
  @ApiProperty() total!: number;
  @ApiProperty() used!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() available!: number;
  @ApiProperty() lastSyncedAt!: string | null;
}

export class EmployeeBalancesResponseDto {
  @ApiProperty() employeeId!: string;
  @ApiProperty({ type: [BalanceResponseDto] }) balances!: BalanceResponseDto[];
}