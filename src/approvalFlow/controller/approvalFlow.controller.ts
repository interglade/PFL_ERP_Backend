import { NextFunction ,Response,Request} from "express";
import { controller, httpDelete, httpGet, httpPatch, httpPost, next, requestBody, response ,request} from "inversify-express-utils";
import { inject } from "inversify";
import { TYPES } from "../../types";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { ControllerLogger } from "../../utils/controllerLogger";
import { ApprovalFlowService } from "../service/approvalFlow.service";

@controller('/approval-flow',deserializeUser,requireUser)
export class ApprovalFlowController {
     constructor(
    @inject(TYPES.ApprovalFlowService )
    private approvalFlowService: ApprovalFlowService ,
  ) {}

    @httpPost("/")
      public async create(
        @request() req:Request,
        @requestBody() data:any,
        @response() res: Response,
        @next() next: NextFunction
      ) {
        try {
         
          const category = await this.approvalFlowService.create(data);
          
          if (!category) {
            ControllerLogger.logOperationFailed('Create', 'Approval Flow', 'could not be created', req, res);
            return res.status(400).json({
              status: "error",
              message: "Approval Flow could not be created",
            });
          }
          
          // Log successful creation
          ControllerLogger.logSuccess('Approval Flow created', category.id, req, res);
          
          res.status(201).json({
            status: "success",
            data: category.id,
            message: "Approval Flow created successfully",
          });
        } catch (err) {
          ControllerLogger.logError('Approval Flow creation', err, req, res);
          next(err);
        }
      }

      @httpGet("/")
  public async getAll(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const type = typeof req.query.type === "string" ? req.query.type : undefined;

      const toPositiveInt = (value: unknown): number | undefined => {
        if (typeof value !== "string" || value.trim() === "") return undefined;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) return undefined;
        return parsed;
      };

      const page = toPositiveInt(req.query.page);
      const limit = toPositiveInt(req.query.limit);

      const result = await this.approvalFlowService.getAll(type, page, limit);

      if (!result.data || result.data.length === 0) {
        ControllerLogger.logNotFound('Approval Flow', type || 'all', req, res);
        return res.status(404).json({ status: "error", message: "Not found" });
      }

      // Log successful data retrieval
      ControllerLogger.logGetAllRecords('Approval Flow', req, res);

      return res.status(200).json({
        status: "success",
        data: result.data,
        allRecords: result.total,
        totalPages: result.totalPages,
        page: result.page,
        limit: result.limit,
      });
    } catch (err) {
      ControllerLogger.logError('Approval Flow retrieval', err, req, res);
      next(err);
    }
  }

  @httpGet("/:id/view")
  public async getByIdView(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const id = req.params.id;
      const flow = await this.approvalFlowService.getbyidforview(id);
      
      if (!flow) {
        ControllerLogger.logNotFound('Approval Flow', id, req, res);
        return res.status(404).json({ status: "error", message: "Not found" });
      }
      
      // Log successful view
      ControllerLogger.logView('Approval Flow', id, req, res);
      
      res.status(200).json({ status: "success", data: flow });
    } catch (err) {
      ControllerLogger.logError('Approval Flow view', err, req, res);
      next(err);
    }
  }

   @httpGet("/:id")
  public async getById(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const id = req.params.id;
      const flow = await this.approvalFlowService.getByIdForUpdate(id);
      
      if (!flow) {
        ControllerLogger.logNotFound('Approval Flow', id, req, res);
        return res.status(404).json({ status: "error", message: "Not found" });
      }
      
      // Log successful view for update
      ControllerLogger.logView('Approval Flow', id, req, res);
      
      res.status(200).json({ status: "success", data: flow });
    } catch (err) {
      ControllerLogger.logError('Approval Flow view', err, req, res);
      next(err);
    }
  }

  @httpPatch("/:id")
  public async update(
    @request() req: Request,
    @requestBody() data: any,
    @response() res: Response,
    @next() next: NextFunction
  ) {
    try {
      const id = req.params.id;
      const updated = await this.approvalFlowService.update(id, data);
      
      if (!updated) {
        ControllerLogger.logOperationFailed('Update', 'Approval Flow', 'not found or could not be updated', req, res);
        return res.status(404).json({ status: "error", message: "Approval Flow not found or could not be updated" });
      }
      
      // Log successful update
      ControllerLogger.logSuccess('Approval Flow updated', id, req, res);
      
      res.status(200).json({ status: "success", data: updated });
    } catch (err) {
      ControllerLogger.logError('Approval Flow update', err, req, res);
      next(err);
    }
  }

  @httpPost('/replace/user')
  async findreplace(
     @request() req: Request,
    @requestBody() data: any,
    @response() res: Response,
    @next() next: NextFunction

  )
  {
     const { oldUserId, newUserId } = data ?? req.body;

    if (!oldUserId || !newUserId) {
      ControllerLogger.logValidationError('User replacement', 'Both oldUserId and newUserId are required', req, res);
      return res.status(400).json({ message: 'Both oldUserId and newUserId are required' });
    }

    try {
      await this.approvalFlowService.replaceUserInApprovalSystem(oldUserId, newUserId);
      
      // Log successful user replacement
      ControllerLogger.logSuccess('User replaced in Approval Flow', `${oldUserId} -> ${newUserId}`, req, res);
      
      return res.status(200).json({ message: 'User references replaced successfully.' });
    } catch (error) {
      ControllerLogger.logError('User replacement in Approval Flow', error, req, res);
      console.error('Error replacing user:', error);
      return res.status(500).json({ message: 'Internal server error', error });
    }

  }

  // GET /approval-flow/user/:userId/:department
  // Params: userId (user uuid), department (DocumentTypeEnum value e.g. "Procurement", "Sale")
  // Returns the approval flow with id+name for every user in the flow
  @httpGet('/user/:userId/:department')
  public async getFlowForUserAndDepartment(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { userId, department } = req.params;

      if (!userId || !department) {
        return res.status(400).json({
          status: 'error',
          message: 'userId and department are required',
        });
      }

      const flow = await this.approvalFlowService.getApprovalFlowForUserAndDepartment(userId, department);

      if (!flow) {
        return res.status(404).json({
          status: 'error',
          message: 'No approval flow found for the given user and department',
        });
      }

      return res.status(200).json({ status: 'success', data: flow });
    } catch (err) {
      ControllerLogger.logError('Get Approval Flow for user+department', err, req, res);
      next(err);
    }
  }

}