import {
    Entity,
    
    Column,
    ManyToOne,
    JoinColumn,
    OneToMany,
    
  } from 'typeorm';
import Model from '../../global/model.entity';
import { RFPA } from '../../rfpa/entity/rfpa.entity';
import { Department, Status } from '../../utils/status.enum';
import { User } from '../../employee/entity/user.entity';


  @Entity('deal_slips')
  export class DealSlip extends Model {
   // Relation to RFPA
   @ManyToOne(() => RFPA, { cascade: true,onDelete: "SET NULL"})
   @JoinColumn({ name: 'rfpa_id' })
   rfpa: RFPA; // Relation to RFPA entity
  
    @Column()
    lotNo: string;
    
    @Column({ type: 'text', nullable: true })
    approvalNote: string; // Note added when approving or rejecting the GRN
  
    @Column()
    loadingLocation: string;
  
    @Column('text', { nullable: true })
    remark: string;

    @Column()
    specialRequest: string;
    
    @Column({
      type: 'enum',
      enum: Department,
      nullable: true
    })
    requestingDepartment: Department;
   
  // @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true})
  // @JoinColumn({ name: "requested" })  // Define the foreign key column
  // requestedBy: User;
  
  @Column({
    type: "enum",
    enum: Status,
    default: Status.PENDING,
    name: "approval_status",
  })
  approvalStatus: Status;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  dealSlipCreatedAt: Date; // Column to store creation date and time

  @Column({ type: "timestamp", nullable: true })
  dealSlipApprovedAt: Date; // Column to store approval date and time
    
    @Column({nullable:true})
    dealSlipNo: string; // Column to store creation date and time
    @Column({ default: false })
  isGrnCreated: boolean;

 

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;
   
  }
  