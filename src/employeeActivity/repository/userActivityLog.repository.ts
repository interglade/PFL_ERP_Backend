import { Repository } from 'typeorm';
import { UserActivityLog } from '../entity/userActivityLog.entity';


export class UserActivityLogRepository extends Repository<UserActivityLog> {}
