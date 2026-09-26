import { inject, injectable } from "inversify";
import { TYPES } from "../../types";
import { DocumentPermissionRepository } from "../repository/documentPermission.repository";


@injectable()
export class   DocumentPermissionService {

    constructor(
        @inject(TYPES.DocumentPermissionRepository) private documentPermissionRepository: DocumentPermissionRepository,
    ){}

     async getDocumentPermissionById(documentId:string):Promise<any>{
        const result = await this.documentPermissionRepository.findOne({where:{id:documentId},
            relations:[
                'documentDefinition',
                'level'
            ]})
if (!result) {
    throw new Error('Permission not found');
}

const formattedResult={
    id: result.id,
    documentDefinition: {
        id: result.documentDefinition.id,
        name: result.documentDefinition.name,
        uniquekey:result.documentDefinition.uniqueKey,
        documentType:result.documentDefinition.documentType,
      
    },
    // level: {
    //     id: result.level.id,
    //     name: result.level.name,
    // },
    canCreate: result.canCreate,
    canView: result.canView,
    canEdit: result.canEdit,
    canDelete: result.canDelete,
    canDownload: result.canDownload,
}

        return formattedResult;

    }

    async getAllDocumentPermissions():Promise<any>{
        const result = await this.documentPermissionRepository.find({relations:[
            'documentDefinition',
            'level'
        ]})
        if (!result) {
            throw new Error('Permissions not found');
        }
        const formattedResult=result.map((permission)=>{
            return {
                id: permission.id,
                documentDefinition: {
                    id: permission.documentDefinition.id,
                    name: permission.documentDefinition.name,
                    uniquekey:permission.documentDefinition.uniqueKey,
                    documentType:permission.documentDefinition.documentType,
                  
                },
                // level: {
                //     id: permission.level.id,
                //     name: permission.level.name,
                // },
                canCreate: permission.canCreate,
                canView: permission.canView,
                canEdit: permission.canEdit,
                canDelete: permission.canDelete,
                canDownload: permission.canDownload,
            }
        })
        return formattedResult;
    }

    async createDocumentPermission(data:any):Promise<any>{
        const { documentDefinitionId, levelId, ...rest } = data;
        const documentPermission = this.documentPermissionRepository.create({
            ...rest,
            documentDefinition: { id: documentDefinitionId },
            level: { id: levelId },
        });
        const result = await this.documentPermissionRepository.save(documentPermission);
        return result;
    }


    
}