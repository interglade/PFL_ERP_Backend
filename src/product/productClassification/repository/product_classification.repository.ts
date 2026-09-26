import { Repository } from "typeorm";
import { ProductClassification } from "../entity/product_classification.entity";



export class ProductClassificationRepository extends Repository<ProductClassification> {}
