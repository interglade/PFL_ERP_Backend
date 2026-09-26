import { Request, Response } from 'express';
import { UserLogger } from './logger';

/**
 * Controller logging utility to standardize logging across all controllers
 */
export class ControllerLogger {

  /**
   * Extract IP address from request
   */
  private static getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'Unknown';
  }

  /**
   * Extract user from response locals
   */
  private static getUser(res: Response): any {
    return res.locals.user || res.locals.updatedBy;
  }

  /**
   * Log successful operations with IP
   */
  static logSuccess(operation: string, entityId: string, req: Request, res: Response) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    UserLogger.infoWithIp(`${operation} successfully with ID: ${entityId}`, user, ip);
  }

  /**
   * Log view operations
   */
  static logView(entityName: string, entityId: string, req: Request, res: Response) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    UserLogger.infoWithIp(`${entityName} viewed successfully with ID: ${entityId}`, user, ip);
  }

  /**
   * Log list/get operations
   */
  static logList(entityName: string, req: Request, res: Response) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    UserLogger.infoWithIp(`${entityName} list retrieved successfully`, user, ip);
  }

  /**
   * Log get all records operations (generic method for any entity)
   */
  static logGetAllRecords(entityName: string, req: Request, res: Response) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    UserLogger.infoWithIp(`${entityName} data retrieved successfully`, user, ip);
  }

  /**
   * Log errors with IP
   */
  static logError(operation: string, error: any, req: Request, res: Response) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    UserLogger.errorWithIp(`${operation} failed: ${error.message}`, user, ip, error);
  }

  /**
   * Log not found errors
   */
  static logNotFound(entityName: string, entityId: string, req: Request, res: Response) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    UserLogger.warnWithIp(`${entityName} not found with ID: ${entityId}`, user, ip);
  }

  /**
   * Log validation errors
   */
  static logValidationError(operation: string, message: string, req: Request, res: Response) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    UserLogger.warnWithIp(`${operation} validation failed: ${message}`, user, ip);
  }

  /**
   * Log operation failures (generic)
   */
  static logOperationFailed(operation: string, entityName: string, reason: string, req: Request, res: Response) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    UserLogger.warnWithIp(`${operation} ${entityName} failed: ${reason}`, user, ip);
  }

  /**
   * Log authentication events
   */
  static logAuth(action: string, req: Request, res: Response, success: boolean = true) {
    const user = this.getUser(res);
    const ip = this.getClientIp(req);
    if (success) {
      UserLogger.infoWithIp(`${action} successful`, user, ip);
    } else {
      UserLogger.warnWithIp(`${action} failed`, user, ip);
    }
  }
}
