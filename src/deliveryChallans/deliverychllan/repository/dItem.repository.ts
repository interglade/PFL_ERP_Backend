import { Repository } from "typeorm";
import { Item } from "../entity/dItem.entity";


export class DitemRepository extends Repository<Item> {
}