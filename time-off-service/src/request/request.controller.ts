import {
    Controller,
    Get,
    Post,
    Patch,
    Param,
    Body,
    Query,
    ParseUUIDPipe,
  } from '@nestjs/common';
  import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
  import { RequestService } from './request.service';
  import {
    CreateTimeOffRequestDto,
    ApproveRequestDto,
    RejectRequestDto,
    RequestQueryDto,
    TimeOffRequestResponseDto,
  } from './request.dto';
  
  @ApiTags('requests')
  @Controller('api/v1/requests')
  export class RequestController {
    constructor(private readonly requestService: RequestService) {}
  
    @Post()
    @ApiOperation({ summary: 'Create a new time-off request' })
    @ApiResponse({ status: 201, type: TimeOffRequestResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid input' })
    @ApiResponse({ status: 409, description: 'Insufficient balance' })
    @ApiResponse({ status: 503, description: 'HCM unavailable' })
    async createRequest(
      @Body() dto: CreateTimeOffRequestDto,
    ): Promise<TimeOffRequestResponseDto> {
      return this.requestService.createRequest(dto);
    }
  
    @Get()
    @ApiOperation({ summary: 'List time-off requests with optional filters' })
    @ApiQuery({ name: 'employeeId', required: false })
    @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUBMITTED_TO_HCM', 'CONFIRMED', 'HCM_REJECTED', 'CANCELLED'] })
    @ApiResponse({ status: 200, type: [TimeOffRequestResponseDto] })
    async getRequests(
      @Query() query: RequestQueryDto,
    ): Promise<TimeOffRequestResponseDto[]> {
      return this.requestService.getRequests(query);
    }
  
    @Get(':id')
    @ApiOperation({ summary: 'Get a time-off request by ID' })
    @ApiResponse({ status: 200, type: TimeOffRequestResponseDto })
    @ApiResponse({ status: 404, description: 'Request not found' })
    async getRequestById(
      @Param('id', ParseUUIDPipe) id: string,
    ): Promise<TimeOffRequestResponseDto> {
      return this.requestService.getRequestById(id);
    }
  
    @Patch(':id/approve')
    @ApiOperation({ summary: 'Approve a time-off request (triggers HCM submission)' })
    @ApiResponse({ status: 200, type: TimeOffRequestResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid state transition' })
    @ApiResponse({ status: 404, description: 'Request not found' })
    @ApiResponse({ status: 503, description: 'HCM unavailable' })
    async approveRequest(
      @Param('id', ParseUUIDPipe) id: string,
      @Body() dto: ApproveRequestDto,
    ): Promise<TimeOffRequestResponseDto> {
      return this.requestService.approveRequest(id, dto.managerNotes);
    }
  
    @Patch(':id/reject')
    @ApiOperation({ summary: 'Reject a time-off request' })
    @ApiResponse({ status: 200, type: TimeOffRequestResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid state transition' })
    @ApiResponse({ status: 404, description: 'Request not found' })
    async rejectRequest(
      @Param('id', ParseUUIDPipe) id: string,
      @Body() dto: RejectRequestDto,
    ): Promise<TimeOffRequestResponseDto> {
      return this.requestService.rejectRequest(id, dto.managerNotes);
    }
  
    @Patch(':id/cancel')
    @ApiOperation({ summary: 'Cancel a time-off request' })
    @ApiResponse({ status: 200, type: TimeOffRequestResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid state transition' })
    @ApiResponse({ status: 404, description: 'Request not found' })
    @ApiResponse({ status: 503, description: 'HCM unavailable (for confirmed requests)' })
    async cancelRequest(
      @Param('id', ParseUUIDPipe) id: string,
    ): Promise<TimeOffRequestResponseDto> {
      return this.requestService.cancelRequest(id);
    }
  }