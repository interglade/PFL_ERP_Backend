import { Repository } from "typeorm";
import { Product } from "../entity/product.entity";


export class ProductRepository extends Repository<Product> {}
