import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import Model from '../../global/model.entity';



@Entity('levels')
export class Levels extends Model {
  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  hierarchy: number;
  // @ManyToOne(() => Departments, { onDelete: 'SET NULL' })
  // @JoinColumn({ name: 'department_id' })
  // department: Departments;

 
}
