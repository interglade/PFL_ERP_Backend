import { Entity,  Column } from 'typeorm';
import Model from '../../global/model.entity';


@Entity()
export class SystemLog extends Model {
 
  @Column()
  userId: string; // Replace with actual user identification logic

  @Column()
  ip: string;

  @Column()
  osPlatform: string;

  @Column()
  osRelease: string;

  @Column()
  osType: string;

  @Column()
  cpuArch: string;

  @Column()
  browser: string;

  @Column()
  device: string;

  @Column()
  osName: string;

 
}
