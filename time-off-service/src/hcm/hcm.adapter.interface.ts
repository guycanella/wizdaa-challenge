export interface HcmBalanceResponse {
    employeeId: string;
    locationId: string;
    leaveType: string;
    totalBalance: number;
    usedBalance: number;
    availableBalance: number;
  }
  
  export interface HcmFileTimeOffRequest {
    employeeId: string;
    locationId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
  }
  
  export interface HcmFileTimeOffResponse {
    referenceId: string;
    status: string;
    employeeId: string;
    locationId: string;
    leaveType: string;
    days: number;
    newBalance: HcmBalanceResponse;
  }
  
  export interface HcmCancelResponse {
    referenceId: string;
    status: string;
    restoredDays: number;
    newBalance: HcmBalanceResponse;
  }
  
  export interface HcmBatchResponse {
    balances: HcmBalanceResponse[];
    total: number;
    generatedAt: string;
  }
  
  export interface HcmError {
    error: string;
    code: string;
    details?: string;
  }
  
  export const HCM_ADAPTER = Symbol('HCM_ADAPTER');
  
  export interface IHcmAdapter {
    /**
     * Get balance for a specific employee, location and leave type.
     * Throws on network/HCM errors.
     */
    getBalance(employeeId: string, locationId: string, leaveType: string): Promise<HcmBalanceResponse>;
  
    /**
     * Get all balances for an employee at a location (all leave types).
     * Throws on network/HCM errors.
     */
    getBalancesAtLocation(employeeId: string, locationId: string): Promise<HcmBalanceResponse[]>;
  
    /**
     * Get all balances in the HCM (for batch sync).
     * Throws on network/HCM errors.
     */
    getAllBalances(): Promise<HcmBatchResponse>;
  
    /**
     * File a time-off entry in the HCM.
     * Returns the HCM confirmation or throws on error.
     */
    fileTimeOff(request: HcmFileTimeOffRequest): Promise<HcmFileTimeOffResponse>;
  
    /**
     * Cancel a previously filed time-off entry.
     * Throws on network/HCM errors.
     */
    cancelTimeOff(referenceId: string): Promise<HcmCancelResponse>;
  }