// UserRepository.ts
import { Repository } from "typeorm";
import { DeliveryDetails } from "../entity/deliveryDetailsCust.entity";




export class DeliveryDetailsCustRepository extends Repository<DeliveryDetails> {}