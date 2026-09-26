import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import Model from '../../global/model.entity';


@Entity('audit_logs')
export class AuditLog  extends Model {
  

  @Column()
  entityName: string;  

  @Column()
  entityId: string; 

  @Column({ type: 'jsonb' })
  changes: Record<string, { oldValue: any; newValue: any }>; 

  @Column()
  updatedBy: string;  

  @CreateDateColumn()
  updatedAt: Date; 
}
