import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
  } from 'typeorm';
  
  export enum SyncType {
    BATCH = 'BATCH',
    REALTIME = 'REALTIME',
    MANUAL = 'MANUAL',
  }
  
  export enum SyncStatus {
    STARTED = 'STARTED',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
  }
  
  @Entity('sync_logs')
  export class SyncLog {
    @PrimaryGeneratedColumn('uuid')
    id!: string;
  
    @Column({ type: 'varchar' })
    syncType!: SyncType;
  
    @Column({ type: 'varchar' })
    status!: SyncStatus;
  
    @Column({ default: 0 })
    recordsProcessed!: number;
  
    @Column({ default: 0 })
    discrepanciesFound!: number;
  
    @Column({ type: 'text', nullable: true })
    details?: string;
  
    @CreateDateColumn()
    startedAt!: Date;
  
    @Column({ type: 'datetime', nullable: true })
    completedAt?: Date;
  }