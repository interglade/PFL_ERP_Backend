import {
    Entity,
    Column,
    ManyToOne,
    JoinColumn,
  
    CreateDateColumn,
    UpdateDateColumn,
  } from "typeorm";
 
  import { ApprovalStatus } from "../utils/status.enum"; // Enum for approval statuses (PENDING, APPROVED, ESCALATED)

import { format,toZonedTime } from "date-fns-tz";
import Model from "../global/model.entity";
import { User } from "../employee/entity/user.entity";
import { Levels } from "../levels/entity/levels.entity";
  
  @Entity("requests")
  export class Requests extends Model{
   
    @ManyToOne(() => User, { nullable: false,onDelete: "SET NULL" })
    @JoinColumn({ name: "submitter_id" })
    submitter: User;  // The user submitting the request
  
  
    @Column({ type: "enum", enum: ApprovalStatus, default: ApprovalStatus.PENDING })
    status: ApprovalStatus;  // Status of the request (Pending, Approved, Escalated)
  
    @ManyToOne(() => User, { nullable: true ,onDelete: "SET NULL"})
    @JoinColumn({ name: "approver_id" })
    approver: User;  // The user who is approving the request
   
    @CreateDateColumn({type: "timestamp",
        transformer: {
          from: (value: string) => {
            return value ? format(toZonedTime(value, "Asia/Kolkata"), "dd-MM-yyyy hh:mm a", { timeZone: "Asia/Kolkata" }) : null;
          },
          to: (value: Date) => value, // Store raw Date object
        },
      })
    createdAt: Date;
  
    @UpdateDateColumn({type: "timestamp",
      transformer: {
        from: (value: string) => {
          return value ? format(toZonedTime(value, "Asia/Kolkata"), "dd-MM-yyyy hh:mm a", { timeZone: "Asia/Kolkata" }) : null;
        },
        to: (value: Date) => value, // Store raw Date object
      },
    })
    updatedAt: Date;
  
    @ManyToOne(() => Levels, { nullable: false,onDelete: "SET NULL" })
    @JoinColumn({ name: "level_id" })
    level: Levels; // The level at which the request is being approved


//     @ManyToOne(() => RFPA, (rfpa) => rfpa.requests, { nullable: false })
// @JoinColumn({ name: "rfpa_id" })
// rfpa: RFPA; // Reference to the parent RFPA

  }
  