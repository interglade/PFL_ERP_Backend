import { controller, httpPost, httpGet, httpDelete, httpPut } from "inversify-express-utils";
import { Request, Response } from "express";
import { inject } from "inversify";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { normalizeDepartment } from "../entity/workflowClosure.entity";
import { ControllerLogger } from "../../utils/controllerLogger";
import { WorkflowHierarchyService } from "../service/workFlowHierarchy.service";

@controller("/workflow", deserializeUser, requireUser)
export class WorkflowHierarchyController {
  constructor(
    @inject(TYPES.WorkflowHierarchyService) private workflowService: WorkflowHierarchyService,
  ) {}

 
  @httpPost("/add")
  async addRelation(req: Request, res: Response) {
    try {
      const { department: rawDepartment, managerId, newSubordinate } = req.body;
     
      const subordinateId = newSubordinate;

      if (!rawDepartment || !managerId || !subordinateId) {
        return res.status(400).json({
          status: "fail",
          message: "Department, managerId, and subordinateId are required"
        });
      }

      const department = normalizeDepartment(rawDepartment);

      const result = await this.workflowService.addSingleRelation(
        department,
        managerId,
        subordinateId
      );

      ControllerLogger.logSuccess('Workflow relation added', `${managerId} -> ${subordinateId}`, req, res);

      // Notification removed — not needed for workflow operations
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Workflow relation added successfully: ${managerId} -> ${subordinateId}`,
      //     userId
      //   );
      // }

      return res.status(201).json({
        status: "success",
        data: result.message
      });
    } catch (error: any) {
        ControllerLogger.logError('Workflow relation addition', error, req, res);
      return res.status(500).json({
        status: "error",
        message: error.message
      });
    }
  }

  
  @httpPost("/bulk")
  async addBulkRelations(req: Request, res: Response) {
    try {
      const { department: rawDepartment, relations } = req.body;

      if (!rawDepartment || !relations || !Array.isArray(relations)) {
        return res.status(400).json({
          status: "fail",
          message: "Department and relations array are required"
        });
      }

      const department = normalizeDepartment(rawDepartment);

      const result = await this.workflowService.addBulkRelations(
        department,
        relations
      );

      ControllerLogger.logSuccess('Bulk workflow relations added', `${relations.length} relations`, req, res);

      return res.status(201).json({
        status: "success",
        data: result.message
      });
    } catch (error: any) {
      ControllerLogger.logError('Bulk workflow relations addition', error, req, res);
      return res.status(500).json({
        status: "error",
        message: error.message
      });
    }
  }

  
 
 
  @httpGet("/getworkflow/:department")
  async getSubordinates(req: Request, res: Response) {

    try {
      const { managerId } = req.query;
      const { department: rawDepartment } = req.params;

      if (!rawDepartment) {
        return res.status(400).json({
          status: "fail",
          message: "Department is required"
        });
      }

      const department = normalizeDepartment(rawDepartment);

      let result;
      
      if (managerId) {
        // If managerId is provided, get subordinates for that manager
        result = await this.workflowService.getSubordinates(
          managerId as string,
          department
        );
      } else {
        // If no managerId, get complete department tree
        result = await this.workflowService.getWorkflowTree(
          department
        );
      }

      ControllerLogger.logList('Workflow tree', req, res);

      // Send notification for workflow tree access
      // const userId = res.locals.user?.id;
      // if (userId) {
      //   await this.notificationService.createNoti(
      //     `Workflow tree accessed for department: ${department}`,
      //     userId
      //   );
      // }

      return res.status(200).json({
        status: "success",
        data: result
      });
    } catch (error: any) {
      ControllerLogger.logError('Workflow tree retrieval', error, req, res);
      return res.status(500).json({
        status: "error",
        message: error.message
      });
    }
  }

  




@httpPut("/update-one")
async updateOneNode(req: Request, res: Response) {
  try {
    const { 
      department: rawDepartment, 
      managerId, 
      oldSubordinate, 
      newSubordinate 
    } = req.body;
const oldSubordinateId=oldSubordinate;
const newSubordinateId=newSubordinate;
    // Validate input
    if (!rawDepartment || !managerId || !oldSubordinateId || !newSubordinateId) {
      return res.status(400).json({
        status: "fail",
        message: "department, managerId, oldSubordinateId, newSubordinateId are required"
      });
    }

    const department = normalizeDepartment(rawDepartment);

    const result = await this.workflowService.updateSingleNode(
      department,
      managerId,
      oldSubordinateId,
      newSubordinateId
    );

    ControllerLogger.logSuccess('Workflow branch updated', managerId, req, res);

    // Send notification for workflow branch update
    // const userId = res.locals.user?.id;
    // if (userId) {
    //   await this.notificationService.createNoti(
    //     `Workflow branch updated successfully: ${managerId}`,
    //     userId
    //   );
    // }

    return res.status(200).json({
      status: "success",
      message: result.message
    });

  } catch (error: any) {
    ControllerLogger.logError('Workflow branch update', error, req, res);
    return res.status(500).json({
      status: "error",
      message: error.message
    });
  }
}

  /**
   * Delete a single node from the workflow hierarchy
   * DELETE /workflow/delete-node/:department/:nodeId
   */
  @httpDelete("/delete-node/:department/:nodeId")
  async deleteSingleNode(req: Request, res: Response) {
    try {
      const { department: rawDepartment, nodeId } = req.params;

      if (!rawDepartment || !nodeId) {
        return res.status(400).json({
          status: "fail",
          message: "Department and nodeId are required"
        });
      }

      const department = normalizeDepartment(rawDepartment);

      const result = await this.workflowService.deleteSingleNode(
        department,
        nodeId
      );

      ControllerLogger.logSuccess('Workflow node deleted', nodeId, req, res);

      return res.status(200).json({
        status: "success",
        data: result
      });
    } catch (error: any) {
      ControllerLogger.logError('Workflow node deletion', error, req, res);
      return res.status(500).json({
        status: "error",
        message: error.message
      });
    }
  }






}


  // /**
  //  * Clean duplicate entries from workflow hierarchy
  //  * DELETE /workflow/clean-duplicates/:department? (department is optional)
  //  */
  // @httpDelete("/clean-duplicates/:department?")
  // async cleanDuplicates(req: Request, res: Response) {
  //   try {
  //     const { department: rawDepartment } = req.params;

  //     const department = rawDepartment ? normalizeDepartment(rawDepartment) : undefined;

  //     const result = await this.workflowService.cleanDuplicates(
  //       department
  //     );

  //     ControllerLogger.logSuccess('Workflow duplicates cleaned', `${result.deletedCount} removed`, req, res);

  //     // Send notification for workflow duplicates cleanup
  //     // const userId = res.locals.user?.id;
  //     // if (userId) {
  //     //   await this.notificationService.createNoti(
  //     //     `Workflow duplicates cleaned: ${result.deletedCount} entries removed`,
  //     //     userId
  //     //   );
  //     // }

  //     return res.status(200).json({
  //       status: "success",
  //       data: result
  //     });
  //   } catch (error: any) {
  //     ControllerLogger.logError('Workflow duplicates cleanup', error, req, res);
  //     return res.status(500).json({
  //       status: "error",
  //       message: error.message
  //     });
  //   }
  // }


// @httpGet("/user/details/:id")
//   async getUserWorkflows(req: Request, res: Response) {
//     try {
//       const userId = req.params.id;

//       if (!userId) {
//         return res.status(400).json({
//           status: "fail",
//           message: "userId is required",
//         });
//       }

//       const data = await this.workflowService.getUserWorkflowsByDepartment(userId);

//       ControllerLogger.logView("User workflows by department", userId, req, res);

//       return res.status(200).json({
//         status: "success",
//         data,
//       });
//     } catch (error: any) {
//       ControllerLogger.logError("User workflows retrieval", error, req, res);
//       return res.status(500).json({
//         status: "error",
//         message: error.message,
//       });
//     }
//   }


  // /**
  //  * Check for duplicate entries in workflow hierarchy
  //  * GET /workflow/check-duplicates/:department? (department is optional)
  //  */
  // @httpGet("/check-duplicates/:department?")
  // async checkDuplicates(req: Request, res: Response) {
  //   try {
  //     const { department: rawDepartment } = req.params;

  //     const department = rawDepartment ? normalizeDepartment(rawDepartment) : undefined;

  //     const result = await this.workflowService.checkDuplicates(
  //       department
  //     );

  //     ControllerLogger.logList('Workflow duplicates check', req, res);

  //     return res.status(200).json({
  //       status: "success",
  //       data: result
  //     });
  //   } catch (error: any) {
  //     ControllerLogger.logError('Workflow duplicates check', error, req, res);
  //     return res.status(500).json({
  //       status: "error",
  //       message: error.message
  //     });
  //   }
  // }


  // /**
  //  * Get the tree structure for a specific manager
  //  * GET /workflow/manager-tree/:managerId/:department
  //  */
  // @httpGet("/manager-tree/:managerId/:department")
  // async getManagerTree(req: Request, res: Response) {
  //   try {
  //     const { managerId, department: rawDepartment } = req.params;

  //     if (!managerId || !rawDepartment) {
  //       return res.status(400).json({
  //         status: "fail",
  //         message: "ManagerId and department are required"
  //       });
  //     }

  //     const department = normalizeDepartment(rawDepartment);

  //     const tree = await this.workflowService.getManagerTree(
  //       managerId,
  //       department
  //     );

  //     ControllerLogger.logView('Manager tree', managerId, req, res);
  //     return res.status(200).json({
  //       status: "success",
  //       data: tree
  //     });
  //   } catch (error: any) {
  //     ControllerLogger.logError('Manager tree retrieval', error, req, res);
  //     return res.status(500).json({
  //       status: "error",
  //       message: error.message
  //     });
  //   }
  // }


  // @httpGet("/managers/:subordinateId/:department")
  // async getManagers(req: Request, res: Response) {
  //   try {
  //     const { subordinateId, department: rawDepartment } = req.params;

  //     if (!subordinateId || !rawDepartment) {
  //       return res.status(400).json({
  //         status: "fail",
  //         message: "SubordinateId and department are required"
  //       });
  //     }

  //     const department = normalizeDepartment(rawDepartment);

  //     const managers = await this.workflowService.getManagers(
  //       subordinateId,
  //       department
  //     );

  //     ControllerLogger.logList('Workflow managers', req, res);
  //     return res.status(200).json({
  //       status: "success",
  //       data: managers
  //     });
  //   } catch (error: any) {
  //     ControllerLogger.logError('Workflow managers retrieval', error, req, res);
  //     return res.status(500).json({
  //       status: "error",
  //       message: error.message
  //     });
  //   }
  // }

