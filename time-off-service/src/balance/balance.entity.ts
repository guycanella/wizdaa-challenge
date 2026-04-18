import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Unique,
  } from 'typeorm';
  
  @Entity('leave_balances')
  @Unique(['employeeId', 'locationId', 'leaveType'])
  export class LeaveBalance {
    @PrimaryGeneratedColumn('uuid')
    id!: string;
  
    @Column()
    employeeId!: string;
  
    @Column()
    locationId!: string;
  
    @Column()
    leaveType!: string;
  
    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    totalBalance!: number;
  
    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    usedBalance!: number;
  
    @Column('decimal', { precision: 10, scale: 2, default: 0 })
    pendingBalance!: number;
  
    get availableBalance(): number {
      return Number(this.totalBalance) - Number(this.usedBalance) - Number(this.pendingBalance);
    }
  
    @Column({ nullable: true })
    hcmVersion?: string;
  
    @Column({ type: 'datetime', nullable: true })
    lastSyncedAt?: Date;
  
    @CreateDateColumn()
    createdAt!: Date;
  
    @UpdateDateColumn()
    updatedAt!: Date;
  }