import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsNumber,
    IsPositive,
    IsOptional,
    IsDateString,
  } from 'class-validator';
  import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
  import { RequestStatus } from './request.entity';
  
  
  export class CreateTimeOffRequestDto {
    @ApiProperty({ example: 'EMP-001' })
    @IsString()
    @IsNotEmpty()
    employeeId!: string;
  
    @ApiProperty({ example: 'LOC-BR-SP' })
    @IsString()
    @IsNotEmpty()
    locationId!: string;
  
    @ApiProperty({ example: 'VACATION', enum: ['VACATION', 'SICK', 'PERSONAL'] })
    @IsString()
    @IsNotEmpty()
    leaveType!: string;
  
    @ApiProperty({ example: '2026-05-01' })
    @IsDateString()
    startDate!: string;
  
    @ApiProperty({ example: '2026-05-05' })
    @IsDateString()
    endDate!: string;
  
    @ApiProperty({ example: 3 })
    @IsNumber()
    @IsPositive()
    days!: number;
  
    @ApiPropertyOptional({ example: 'Family trip' })
    @IsOptional()
    @IsString()
    reason?: string;
  }
  
  
  export class ApproveRequestDto {
    @ApiPropertyOptional({ example: 'Approved. Enjoy your vacation!' })
    @IsOptional()
    @IsString()
    managerNotes?: string;
  }
  
  export class RejectRequestDto {
    @ApiProperty({ example: 'Team is short-staffed during that period.' })
    @IsString()
    @IsNotEmpty()
    managerNotes!: string;
  }
  
  
  export class RequestQueryDto {
    @ApiPropertyOptional({ example: 'EMP-001' })
    @IsOptional()
    @IsString()
    employeeId?: string;
  
    @ApiPropertyOptional({ enum: RequestStatus })
    @IsOptional()
    @IsEnum(RequestStatus)
    status?: RequestStatus;
  }
  
  
  export class TimeOffRequestResponseDto {
    @ApiProperty() id!: string;
    @ApiProperty() employeeId!: string;
    @ApiProperty() locationId!: string;
    @ApiProperty() leaveType!: string;
    @ApiProperty() startDate!: string;
    @ApiProperty() endDate!: string;
    @ApiProperty() days!: number;
    @ApiProperty({ enum: RequestStatus }) status!: RequestStatus;
    @ApiPropertyOptional() reason?: string;
    @ApiPropertyOptional() managerNotes?: string;
    @ApiPropertyOptional() hcmReferenceId?: string;
    @ApiPropertyOptional() hcmSubmissionError?: string;
    @ApiProperty() createdAt!: string;
    @ApiProperty() updatedAt!: string;
  }