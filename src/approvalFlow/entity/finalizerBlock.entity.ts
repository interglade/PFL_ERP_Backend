import { Entity, JoinTable, ManyToMany } from "typeorm";
import { User } from "../../employee/entity/user.entity";
import Model from "../../global/model.entity";


@Entity('finalizer_blocks')
export class FinalizerBlock extends Model {
 

  @ManyToMany(() => User)
  @JoinTable({
    name: 'finalizer_block_first_finalizers',
    joinColumn: { name: 'finalizer_block_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' }
  })
  firstFinalizers: User[];

  @ManyToMany(() => User)
  @JoinTable({
    name: 'finalizer_block_second_finalizers',
    joinColumn: { name: 'finalizer_block_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' }
  })
  secondFinalizers: User[];
}
