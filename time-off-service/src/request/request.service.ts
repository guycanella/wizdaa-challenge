import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TimeOffRequest, RequestStatus } from './request.entity';
import { CreateTimeOffRequestDto, TimeOffRequestResponseDto } from './request.dto';
import { BalanceService } from '../balance/balance.service';
import { HCM_ADAPTER, IHcmAdapter } from '../hcm/hcm.adapter.interface';
import { HcmUnavailableError, HcmValidationError } from '../hcm/hcm.adapter';

@Injectable()
export class RequestService {
  private readonly logger = new Logger(RequestService.name);
  private readonly maxRetries: number;
  private readonly retryBaseDelay: number;

  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestRepo: Repository<TimeOffRequest>,
    private readonly balanceService: BalanceService,
    @Inject(HCM_ADAPTER)
    private readonly hcmAdapter: IHcmAdapter,
    private readonly configService: ConfigService,
  ) {
    this.maxRetries = this.configService.get<number>('hcm.retryAttempts', 3);
    this.retryBaseDelay = this.configService.get<number>('hcm.retryBaseDelay', 1000);
  }


  async createRequest(dto: CreateTimeOffRequestDto): Promise<TimeOffRequestResponseDto> {
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException('Start date must be before or equal to end date');
    }

    try {
      await this.balanceService.syncBalanceFromHcm(dto.employeeId, dto.locationId, dto.leaveType);
    } catch (error) {
      if (error instanceof HcmUnavailableError) {
        throw new ServiceUnavailableException(
          'Unable to process time-off request: the HCM system is currently unavailable. Please try again later.',
        );
      }
      throw error;
    }

    try {
      await this.balanceService.reserveBalance(
        dto.employeeId,
        dto.locationId,
        dto.leaveType,
        dto.days,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('Insufficient balance')) {
        throw new ConflictException(error.message);
      }
      throw error;
    }

    const request = this.requestRepo.create({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      leaveType: dto.leaveType,
      startDate: dto.startDate,
      endDate: dto.endDate,
      days: dto.days,
      reason: dto.reason,
      status: RequestStatus.PENDING,
      retryCount: 0,
    });

    const saved = await this.requestRepo.save(request);
    return this.toResponseDto(saved);
  }


  async approveRequest(id: string, managerNotes?: string): Promise<TimeOffRequestResponseDto> {
    const request = await this.findRequestOrFail(id);
    this.assertTransition(request, RequestStatus.APPROVED);

    try {
      await this.balanceService.syncBalanceFromHcm(
        request.employeeId,
        request.locationId,
        request.leaveType,
      );
    } catch (error) {
      if (error instanceof HcmUnavailableError) {
        throw new ServiceUnavailableException(
          'Unable to approve request: the HCM system is currently unavailable. Please try again later.',
        );
      }
      throw error;
    }

    request.status = RequestStatus.APPROVED;
    request.managerNotes = managerNotes;
    await this.requestRepo.save(request);

    return this.submitToHcm(request);
  }


  async rejectRequest(id: string, managerNotes: string): Promise<TimeOffRequestResponseDto> {
    const request = await this.findRequestOrFail(id);
    this.assertTransition(request, RequestStatus.REJECTED);

    request.status = RequestStatus.REJECTED;
    request.managerNotes = managerNotes;

    await this.balanceService.releaseReservation(
      request.employeeId,
      request.locationId,
      request.leaveType,
      Number(request.days),
    );

    const saved = await this.requestRepo.save(request);
    return this.toResponseDto(saved);
  }


  async cancelRequest(id: string): Promise<TimeOffRequestResponseDto> {
    const request = await this.findRequestOrFail(id);
    this.assertTransition(request, RequestStatus.CANCELLED);

    const previousStatus = request.status;

    if (previousStatus === RequestStatus.CONFIRMED) {
      try {
        await this.hcmAdapter.cancelTimeOff(request.hcmReferenceId!);
      } catch (error) {
        if (error instanceof HcmUnavailableError) {
          throw new ServiceUnavailableException(
            'Unable to cancel request: the HCM system is currently unavailable. Please try again later.',
          );
        }
        if (error instanceof HcmValidationError) {
          throw new BadRequestException(
            `HCM rejected cancellation: ${error.message}`,
          );
        }
        throw error;
      }

      await this.balanceService.restoreUsage(
        request.employeeId,
        request.locationId,
        request.leaveType,
        Number(request.days),
      );
    } else {
      await this.balanceService.releaseReservation(
        request.employeeId,
        request.locationId,
        request.leaveType,
        Number(request.days),
      );
    }

    request.status = RequestStatus.CANCELLED;
    const saved = await this.requestRepo.save(request);
    return this.toResponseDto(saved);
  }


  async getRequestById(id: string): Promise<TimeOffRequestResponseDto> {
    const request = await this.findRequestOrFail(id);
    return this.toResponseDto(request);
  }

  async getRequests(filters: { employeeId?: string; status?: RequestStatus }): Promise<TimeOffRequestResponseDto[]> {
    const where: Record<string, string> = {};
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.status) where.status = filters.status;

    const requests = await this.requestRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });

    return requests.map(this.toResponseDto);
  }


  private async submitToHcm(request: TimeOffRequest): Promise<TimeOffRequestResponseDto> {
    this.assertTransition(request, RequestStatus.SUBMITTED_TO_HCM);
    request.status = RequestStatus.SUBMITTED_TO_HCM;
    await this.requestRepo.save(request);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const hcmResponse = await this.hcmAdapter.fileTimeOff({
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType,
          startDate: request.startDate,
          endDate: request.endDate,
          days: Number(request.days),
        });

        request.hcmReferenceId = hcmResponse.referenceId;
        request.status = RequestStatus.CONFIRMED;

        await this.balanceService.confirmUsage(
          request.employeeId,
          request.locationId,
          request.leaveType,
          Number(request.days),
        );

        const saved = await this.requestRepo.save(request);
        return this.toResponseDto(saved);

      } catch (error) {
        request.retryCount = attempt;

        if (error instanceof HcmValidationError) {
          request.status = RequestStatus.HCM_REJECTED;
          request.hcmSubmissionError = `${error.code}: ${error.message}`;

          await this.balanceService.releaseReservation(
            request.employeeId,
            request.locationId,
            request.leaveType,
            Number(request.days),
          );

          const saved = await this.requestRepo.save(request);
          return this.toResponseDto(saved);
        }

        if (error instanceof HcmUnavailableError) {
          this.logger.warn(
            `HCM submission attempt ${attempt}/${this.maxRetries} failed for request ${request.id}: ${error.message}`,
          );

          if (attempt < this.maxRetries) {
            const delay = this.retryBaseDelay * Math.pow(4, attempt - 1);
            await this.sleep(delay);
            continue;
          }

          request.status = RequestStatus.HCM_REJECTED;
          request.hcmSubmissionError = `HCM unavailable after ${this.maxRetries} attempts: ${error.message}`;

          await this.balanceService.releaseReservation(
            request.employeeId,
            request.locationId,
            request.leaveType,
            Number(request.days),
          );

          const saved = await this.requestRepo.save(request);
          return this.toResponseDto(saved);
        }

        throw error;
      }
    }

    const saved = await this.requestRepo.save(request);
    return this.toResponseDto(saved);
  }

  private async findRequestOrFail(id: string): Promise<TimeOffRequest> {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Time-off request ${id} not found`);
    }
    return request;
  }

  private assertTransition(request: TimeOffRequest, newStatus: RequestStatus): void {
    if (!request.canTransitionTo(newStatus)) {
      throw new BadRequestException(
        `Cannot transition request from ${request.status} to ${newStatus}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private toResponseDto(request: TimeOffRequest): TimeOffRequestResponseDto {
    return {
      id: request.id,
      employeeId: request.employeeId,
      locationId: request.locationId,
      leaveType: request.leaveType,
      startDate: request.startDate,
      endDate: request.endDate,
      days: Number(request.days),
      status: request.status,
      reason: request.reason,
      managerNotes: request.managerNotes,
      hcmReferenceId: request.hcmReferenceId,
      hcmSubmissionError: request.hcmSubmissionError,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    };
  }
}