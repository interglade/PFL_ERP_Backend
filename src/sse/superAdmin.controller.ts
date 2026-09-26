import { controller, httpDelete, httpPatch, request, requestParam, response } from "inversify-express-utils";
import { Response,Request,NextFunction } from "express";
import { deserializeUser, requireUser } from "../middleware/deserializeUser";
import { inject } from "inversify";
import { TYPES } from "../types";
import { SuperAdminService } from "./superadmin.service";

@controller("/super-admin", deserializeUser, requireUser)
export class SuperAdminController { 


    constructor(
      @inject(TYPES.SuperAdminService) private readonly superAdminService: SuperAdminService
  ) {
    
  }


  @httpPatch("/soft-delete/:id")
  async softDelete(@request() req: Request, 
                   @response() res: Response,
                   @requestParam('id') id: string,) {
   
   const data = await this.superAdminService.softDeleteDocument(id);
    return res.status(200).json(data);
  }


  @httpPatch("/restore/:id")
  async restore(@request() req: Request, @response() res: Response) {
    const { id } = req.params;
 

    await this.superAdminService.restoreDocument(id);
    return res.json({ message: "Document restored successfully" });
  }

   
  @httpDelete("/permanent/:id")
  async permanentDelete(@request() req: Request, @response() res: Response) {
    const { id } = req.params;
   

    await this.superAdminService.permanentDeleteDocument(id);
    return res.json({ message: "Document permanently deleted" });
  }

}