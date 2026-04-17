import { z } from 'zod';

export const LeaveType = z.enum(['VACATION', 'SICK', 'PERSONAL']);
export type LeaveType = z.infer<typeof LeaveType>;

export const BalanceKey = z.object({
  employeeId: z.string().min(1),
  locationId: z.string().min(1),
  leaveType: LeaveType,
});
export type BalanceKey = z.infer<typeof BalanceKey>;

export const BalanceRecord = BalanceKey.extend({
  totalBalance: z.number().nonnegative(),
  usedBalance: z.number().nonnegative(),
});
export type BalanceRecord = z.infer<typeof BalanceRecord>;

export const BalanceResponse = BalanceRecord.extend({
  availableBalance: z.number(),
});
export type BalanceResponse = z.infer<typeof BalanceResponse>;

export const FileTimeOffRequest = z.object({
  employeeId: z.string().min(1),
  locationId: z.string().min(1),
  leaveType: LeaveType,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().positive(),
});
export type FileTimeOffRequest = z.infer<typeof FileTimeOffRequest>;

export const FileTimeOffResponse = z.object({
  referenceId: z.string(),
  status: z.literal('CONFIRMED'),
  employeeId: z.string(),
  locationId: z.string(),
  leaveType: LeaveType,
  days: z.number(),
  newBalance: BalanceResponse,
});
export type FileTimeOffResponse = z.infer<typeof FileTimeOffResponse>;

export const CancelTimeOffResponse = z.object({
  referenceId: z.string(),
  status: z.literal('CANCELLED'),
  restoredDays: z.number(),
  newBalance: BalanceResponse,
});
export type CancelTimeOffResponse = z.infer<typeof CancelTimeOffResponse>;

export const SimulateAnniversaryRequest = z.object({
  employeeId: z.string().min(1),
  locationId: z.string().min(1),
  leaveType: LeaveType.default('VACATION'),
  bonusDays: z.number().positive(),
});
export type SimulateAnniversaryRequest = z.infer<typeof SimulateAnniversaryRequest>;

export const SimulateErrorModeRequest = z.object({
  enabled: z.boolean(),
  errorType: z.enum(['timeout', '500', '400', 'validation']).optional(),
  errorRate: z.number().min(0).max(1).default(1),
});
export type SimulateErrorModeRequest = z.infer<typeof SimulateErrorModeRequest>;

export const SeedBalanceRequest = z.array(BalanceRecord);
export type SeedBalanceRequest = z.infer<typeof SeedBalanceRequest>;

export const HcmError = z.object({
  error: z.string(),
  code: z.string(),
  details: z.string().optional(),
});
export type HcmError = z.infer<typeof HcmError>;