import { inject, injectable } from "inversify";
import { TYPES } from "../../types";
import { GrnProductRepository } from "../repository/grnProduct.repository";


@injectable()
export class GrnProductService {

    constructor(@inject(TYPES.GrnProductRepository) private readonly grnProductRepository: GrnProductRepository) {
    }


}