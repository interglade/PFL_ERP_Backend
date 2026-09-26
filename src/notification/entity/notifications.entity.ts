import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne } from "typeorm";
import { User } from "../../employee/entity/user.entity";
import Model from "../../global/model.entity";


@Entity('notifications')
export class Notification extends Model {

    @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({ name: 'user_id' })
    user: User;
    @Column({ default: false })
    isRead: boolean;

    @Column()
    message: string;


    @CreateDateColumn()
    createdAt: Date;

}
