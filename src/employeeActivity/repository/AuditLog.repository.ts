import { Repository } from "typeorm";
import { AuditLog } from "../entity/auditLog.entity";

export class AuditLogRepository extends Repository<AuditLog> {}
