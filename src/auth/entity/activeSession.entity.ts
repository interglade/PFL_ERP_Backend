import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import Model from "../../global/model.entity";


@Entity("active_sessions")
export class ActiveSession extends Model {
  
  @Column()
  user_id: string;

  @Column()
  username: string;

  @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  login_time: Date;

  @Column({ default: true })
  is_active: boolean;



}