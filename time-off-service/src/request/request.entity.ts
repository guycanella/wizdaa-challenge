import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
  } from 'typeorm';
  
  export enum RequestStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    SUBMITTED_TO_HCM = 'SUBMITTED_TO_HCM',
    CONFIRMED = 'CONFIRMED',
    HCM_REJECTED = 'HCM_REJECTED',
    CANCELLED = 'CANCELLED',
  }
  
  export const VALID_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
    [RequestStatus.PENDING]: [RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED],
    [RequestStatus.APPROVED]: [RequestStatus.SUBMITTED_TO_HCM],
    [RequestStatus.REJECTED]: [],
    [RequestStatus.SUBMITTED_TO_HCM]: [RequestStatus.CONFIRMED, RequestStatus.HCM_REJECTED],
    [RequestStatus.CONFIRMED]: [RequestStatus.CANCELLED],
    [RequestStatus.HCM_REJECTED]: [],
    [RequestStatus.CANCELLED]: [],
  };
  
  @Entity('time_off_requests')
  export class TimeOffRequest {
    @PrimaryGeneratedColumn('uuid')
    id!: string;
  
    @Column()
    employeeId!: string;
  
    @Column()
    locationId!: string;
  
    @Column()
    leaveType!: string;
  
    @Column({ type: 'date' })
    startDate!: string;
  
    @Column({ type: 'date' })
    endDate!: string;
  
    @Column('decimal', { precision: 10, scale: 2 })
    days!: number;
  
    @Column({ type: 'varchar', default: RequestStatus.PENDING })
    status!: RequestStatus;
  
    @Column({ nullable: true })
    reason?: string;
  
    @Column({ nullable: true })
    managerNotes?: string;
  
    @Column({ nullable: true })
    hcmReferenceId?: string;
  
    @Column({ nullable: true })
    hcmSubmissionError?: string;
  
    @Column({ default: 0 })
    retryCount!: number;
  
    @CreateDateColumn()
    createdAt!: Date;
  
    @UpdateDateColumn()
    updatedAt!: Date;
  
    canTransitionTo(newStatus: RequestStatus): boolean {
      return VALID_TRANSITIONS[this.status]?.includes(newStatus) ?? false;
    }
  }