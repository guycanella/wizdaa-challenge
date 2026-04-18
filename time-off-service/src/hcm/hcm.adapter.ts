import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  IHcmAdapter,
  HcmBalanceResponse,
  HcmFileTimeOffRequest,
  HcmFileTimeOffResponse,
  HcmCancelResponse,
  HcmBatchResponse,
} from './hcm.adapter.interface';

export class HcmUnavailableError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'HcmUnavailableError';
  }
}

export class HcmValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HcmValidationError';
  }
}

@Injectable()
export class HcmAdapter implements IHcmAdapter {
  private readonly logger = new Logger(HcmAdapter.name);
  private readonly client: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.get<string>('hcm.baseUrl');
    const timeout = this.configService.get<number>('hcm.timeout');

    this.client = axios.create({
      baseURL,
      timeout,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getBalance(employeeId: string, locationId: string, leaveType: string): Promise<HcmBalanceResponse> {
    try {
      const response = await this.client.get(
        `/hcm/balances/${employeeId}/${locationId}`,
        { params: { leaveType } },
      );
      return response.data;
    } catch (error) {
      throw this.handleError(error, `getBalance(${employeeId}, ${locationId}, ${leaveType})`);
    }
  }

  async getBalancesAtLocation(employeeId: string, locationId: string): Promise<HcmBalanceResponse[]> {
    try {
      const response = await this.client.get(`/hcm/balances/${employeeId}/${locationId}`);
      return response.data.balances || [response.data];
    } catch (error) {
      throw this.handleError(error, `getBalancesAtLocation(${employeeId}, ${locationId})`);
    }
  }

  async getAllBalances(): Promise<HcmBatchResponse> {
    try {
      const response = await this.client.get('/hcm/balances/batch');
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getAllBalances()');
    }
  }

  async fileTimeOff(request: HcmFileTimeOffRequest): Promise<HcmFileTimeOffResponse> {
    try {
      const response = await this.client.post('/hcm/time-off', request);
      return response.data;
    } catch (error) {
      throw this.handleError(error, `fileTimeOff(${request.employeeId})`);
    }
  }

  async cancelTimeOff(referenceId: string): Promise<HcmCancelResponse> {
    try {
      const response = await this.client.delete(`/hcm/time-off/${referenceId}`, {
        headers: { 'Content-Type': undefined },
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error, `cancelTimeOff(${referenceId})`);
    }
  }

  private handleError(error: unknown, context: string): Error {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const data = error.response?.data;

      if (!error.response || error.code === 'ECONNABORTED' || error.code === 'ECONNREFUSED') {
        this.logger.error(`HCM unavailable during ${context}: ${error.message}`);
        return new HcmUnavailableError(
          'The HCM system is currently unavailable. Please try again later.',
          error,
        );
      }

      if (status && status >= 400) {
        const hcmCode = data?.code || 'UNKNOWN';
        const hcmMessage = data?.error || error.message;

        if (status >= 500) {
          this.logger.error(`HCM server error during ${context}: ${status} - ${hcmMessage}`);
          return new HcmUnavailableError(`HCM server error: ${hcmMessage}`, error);
        }

        this.logger.warn(`HCM rejected ${context}: ${status} - ${hcmCode} - ${hcmMessage}`);
        return new HcmValidationError(hcmMessage, hcmCode, status);
      }
    }

    this.logger.error(`Unexpected error during ${context}: ${error}`);
    return new HcmUnavailableError('Unexpected error communicating with HCM');
  }
}