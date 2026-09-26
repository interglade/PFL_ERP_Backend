import { inject, injectable } from "inversify";
import { DocumentDefinitionRepository } from "../repository/documentDefination.repository";
import { TYPES } from "../../types";


@injectable()
export class  DocumentDefinitionService {

    constructor(
        @inject(TYPES.DocumentDefinitionRepository) private documentDefinitionRepository: DocumentDefinitionRepository,
    ){}

    async getAllDocumentDefinitions():Promise<any>{
        const result = await this.documentDefinitionRepository.find()
        const formatResponse = result.map((item:any) => {
            return {
                id: item.id,
                uniqueKey: item.uniqueKey,
                name: item.name,
                documentType: item.documentType,
                }
        })
        return formatResponse
    }



    async createDocumentDefinition(data:any):Promise<any>{
        const result = await this.documentDefinitionRepository.create(data)
        return await this.documentDefinitionRepository.save(result)
    
    }


}


    // async updateDocumentDefinition(id:string, data:any):Promise<any>{
    //     const result = await this.documentDefinitionRepository.findOne({ where: { id } })
    //     if(!result){
    //         return null
    //     }
    //     this.documentDefinitionRepository.merge(result, data)
    //     return await this.documentDefinitionRepository.save(result)
    // }


    // async getDocumentDefinitionById(id:string):Promise<any>{
    //     const result = await this.documentDefinitionRepository.findOne({ where: { id } })
    //     if(!result){
    //         return null
    //     }
    //     const formatResponse = {
    //         id: result.id,
    //         uniqueKey: result.uniqueKey,
    //         name: result.name,
    //         documentType: result.documentType,
    //     }
    //     return formatResponse
    // }

