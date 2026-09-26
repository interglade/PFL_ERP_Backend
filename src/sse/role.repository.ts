import { ObjectLiteral, Repository } from "typeorm";
import { Role } from "../employee/entity/user.entity";


export class RoleRepository extends Repository<Role & ObjectLiteral> {

}
