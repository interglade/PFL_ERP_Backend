import { inject } from "inversify";
import { controller, httpGet, httpPatch, httpPost, next, request, requestParam, response } from "inversify-express-utils";
import { TYPES } from "../../types";
import { DocumentDefinitionService } from "../service/documentDefinition.service";
import { NextFunction,Request,Response } from "express";
import { ControllerLogger } from "../../utils/controllerLogger";
import AppError from "../../utils/appError";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";


@controller('/document-details',deserializeUser,requireUser)
export class  DocumentDefinitionController {

    constructor(
        @inject(TYPES.DocumentDefinitionService) private documentDefinitionService: DocumentDefinitionService,
    ){

    }

    @httpGet('/')
    public async getAllDocumentDef(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
      ) {
        try {
          const document = await this.documentDefinitionService.getAllDocumentDefinitions();
          
          if (!document) {
            ControllerLogger.logOperationFailed('Get All', 'Document Definitions', 'No records found', req, res);
            return next(new AppError(404, "No documents found"));
          }
          
          ControllerLogger.logGetAllRecords('Document Definitions', req, res);
          res.status(200).json({
            status: "success",
            data: document,
          });
        } catch (err) {
          ControllerLogger.logError('Get All Document Definitions', err, req, res);
          next(err);
        }
      }
    


      @httpPost('/')
      public async createDocumentDef(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
      ) {
        try {
          const data = req.body;
          
          const document = await this.documentDefinitionService.createDocumentDefinition(data);
          
          if (!document) {
            ControllerLogger.logOperationFailed('Create', 'Document Definition', 'Creation failed', req, res);
            return next(new AppError(400, "Failed to create documentDef"));
          }
         
          ControllerLogger.logSuccess('Document Definition created', document.id, req, res);
          res.status(201).json({
            status: "success",
            data: document,
          });
        } catch (err) {
          ControllerLogger.logError('Create Document Definition', err, req, res);
          next(err);
        }
      }


}


      // @httpPatch('/:id')
      // public async updateDocumentDef(
      //   @requestParam('id') id: string,
      //   @request() req: Request,
      //   @response() res: Response,
      //   @next() next: NextFunction
      // ) {
      //   try {
      //     const data = req.body;
          
      //     const document = await this.documentDefinitionService.updateDocumentDefinition(id, data);
          
      //     if (!document) {
      //       ControllerLogger.logNotFound('Document Definition', id, req, res);
      //       return next(new AppError(404, "No documents found with this id"));
      //     }
          
      //     ControllerLogger.logSuccess('Document Definition updated', id, req, res);
      //     res.status(200).json({
      //       status: "success",
      //       data: document,
      //     });
      //   } catch (err) {
      //     ControllerLogger.logError('Update Document Definition', err, req, res);
      //     next(err);
      //   }
      // }


    // @httpGet('/:id')
    // public async getDocumentDefById(
    //     @requestParam('id') id: string,
    //     @request() req: Request,
    //     @response() res: Response,
    //     @next() next: NextFunction
    //   ) {
    //     try {
    //       const document = await this.documentDefinitionService.getDocumentDefinitionById(id);
          
    //       if (!document) {
    //         ControllerLogger.logNotFound('Document Definition', id, req, res);
    //         return next(new AppError(404, "No documents found with this id"));
    //       }
         
    //       ControllerLogger.logView('Document Definition', id, req, res);
    //       res.status(200).json({
    //         status: "success",
    //         data: document,
    //       });
    //     } catch (err) {
    //       ControllerLogger.logError('Get Document Definition by ID', err, req, res);
    //       next(err);
    //     }
    //   }

