// UserRepository.ts
import { Repository } from "typeorm";
import { UOMConversionMatrix } from "../entity/uom_matrix.entity";



export class UOMConversionMatrixRepository extends Repository<UOMConversionMatrix> {}
