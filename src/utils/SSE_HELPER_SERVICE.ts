// src/services/sse-helper.service.ts
import { injectable, inject } from 'inversify';
import { TYPES } from '../types';

import { UserRepository } from '../employee/repository/user.repository';
import logger from '../utils/logger';
import { NotificationService } from '../notification/service/notification.service';
import { DocumentbService } from '../approvalFlow/service/documentb.service';
;

export interface SSENotificationOptions {
  documentId: string;
  documentNo: string;
  documentType: string;
  actionUserId: string;
  creatorId?: string;
  action: 'created' | 'updated' | 'deleted' | 'viewed' | 'editing' | 'approved' | 'rejected';
  customMessage?: string;
}

@injectable()
export class SSEHelperService {
  constructor(
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.DocumentbService)
    private documentbService: DocumentbService,
    @inject(TYPES.UserRepository)
    private userRepository: UserRepository,
  ) {}

  /**
   * Send notification for document creation
   */
  async notifyDocumentCreated(options: SSENotificationOptions): Promise<void> {
    try {
      const { documentNo, documentType, actionUserId, documentId } = options;

      // Notify creator
      await this.notificationService.createNoti(
        `${documentType} ${documentNo} created successfully and submitted for approval`,
        actionUserId
      );
      logger.info(`Creation notification sent to user ${actionUserId} for ${documentType} ${documentNo}`);

      // Notify approvers
      await this.notifyApprovers(documentId, documentNo, documentType, actionUserId, 'created');
    } catch (error) {
      logger.error('Failed to send creation notifications:', error);
    }
  }

  /**
   * Send notification for document update
   */
  async notifyDocumentUpdated(options: SSENotificationOptions): Promise<void> {
    try {
      const { documentNo, documentType, actionUserId, documentId } = options;

      // Notify updater
      await this.notificationService.createNoti(
        `${documentType} ${documentNo} updated successfully`,
        actionUserId
      );
      logger.info(`Update notification sent to user ${actionUserId} for ${documentType} ${documentNo}`);

      // Notify approvers about update
      await this.notifyApprovers(
        documentId,
        documentNo,
        documentType,
        actionUserId,
        'updated',
        `${documentType} ${documentNo} has been updated and requires re-approval`
      );
    } catch (error) {
      logger.error('Failed to send update notifications:', error);
    }
  }

  /**
   * Send notification for document deletion
   */
  async notifyDocumentDeleted(options: SSENotificationOptions): Promise<void> {
    try {
      const { documentNo, documentType, actionUserId, documentId, creatorId } = options;

      // Notify deleter
      await this.notificationService.createNoti(
        `${documentType} ${documentNo} deleted successfully`,
        actionUserId
      );
      logger.info(`Delete notification sent to user ${actionUserId} for ${documentType} ${documentNo}`);

      // Notify creator if different
      if (creatorId && creatorId !== actionUserId) {
        await this.notificationService.createNoti(
          `${documentType} ${documentNo} has been deleted`,
          creatorId
        );
      }

      // Notify approvers
      await this.notifyApprovers(
        documentId,
        documentNo,
        documentType,
        actionUserId,
        'deleted',
        `${documentType} ${documentNo} has been deleted`
      );
    } catch (error) {
      logger.error('Failed to send delete notifications:', error);
    }
  }

  /**
   * Send notification when document is viewed by approver
   */
  async notifyDocumentViewed(options: SSENotificationOptions): Promise<void> {
    try {
      const { documentNo, documentType, actionUserId, documentId, creatorId } = options;

      const document = await this.documentbService.getDocumentByTypeId(documentId);
      
      if (document && document.approvalFlow) {
        const isApprover = await this.isUserApprover(actionUserId, document.approvalFlow);

        if (isApprover && creatorId && creatorId !== actionUserId) {
          const viewer = await this.userRepository.findOne({ where: { id: actionUserId } });
          const viewerName = viewer ? `${viewer.firstName} ${viewer.lastName}` : 'An approver';
          
          await this.notificationService.createNoti(
            `${viewerName} viewed ${documentType} ${documentNo}`,
            creatorId
          );
          logger.info(`View notification sent to creator for ${documentType} ${documentNo}`);
        }
      }
    } catch (error) {
      logger.error('Failed to send view notification:', error);
    }
  }

  /**
   * Send notification when document is opened for editing
   */
  async notifyDocumentEditing(options: SSENotificationOptions): Promise<void> {
    try {
      const { documentNo, documentType, actionUserId, documentId, creatorId } = options;

      // Notify creator if someone else is editing
      if (creatorId && creatorId !== actionUserId) {
        const editor = await this.userRepository.findOne({ where: { id: actionUserId } });
        const editorName = editor ? `${editor.firstName} ${editor.lastName}` : 'Someone';
        
        await this.notificationService.createNoti(
          `${editorName} is editing ${documentType} ${documentNo}`,
          creatorId
        );
        logger.info(`Edit notification sent to creator for ${documentType} ${documentNo}`);
      }

      // Notify approvers
      await this.notifyApprovers(
        documentId,
        documentNo,
        documentType,
        actionUserId,
        'editing',
        `${documentType} ${documentNo} is being edited and may require re-approval`
      );
    } catch (error) {
      logger.error('Failed to send edit notification:', error);
    }
  }

  /**
   * Send notification for document approval/rejection
   */
  async notifyDocumentApprovalAction(
    documentId: string,
    documentNo: string,
    documentType: string,
    approverId: string,
    action: 'approved' | 'rejected',
    creatorId?: string
  ): Promise<void> {
    try {
      const actionText = action === 'approved' ? 'approved' : 'rejected';
      const approver = await this.userRepository.findOne({ where: { id: approverId } });
      const approverName = approver ? `${approver.firstName} ${approver.lastName}` : 'An approver';

      // Notify creator
      if (creatorId && creatorId !== approverId) {
        await this.notificationService.createNoti(
          `${documentType} ${documentNo} has been ${actionText} by ${approverName}`,
          creatorId
        );
      }

      // Notify other approvers
      const document = await this.documentbService.getDocumentByTypeId(documentId);
      if (document && document.approvalFlow) {
        const approvers = await this.collectApprovers(document.approvalFlow, approverId);
        
        for (const userId of approvers) {
          await this.notificationService.createNoti(
            `${documentType} ${documentNo} has been ${actionText}`,
            userId
          );
        }
      }

      logger.info(`${action} notification sent for ${documentType} ${documentNo}`);
    } catch (error) {
      logger.error(`Failed to send ${action} notifications:`, error);
    }
  }

  /**
   * Send bulk delete notifications
   */
  async notifyBulkDelete(
    documentType: string,
    count: number,
    deletedBy: string,
    affectedUserIds: Set<string>
  ): Promise<void> {
    try {
      // Notify deleter
      await this.notificationService.createNoti(
        `${count} ${documentType}s deleted successfully`,
        deletedBy
      );

      // Notify all affected users
      for (const userId of affectedUserIds) {
        if (userId !== deletedBy) {
          await this.notificationService.createNoti(
            `${count} ${documentType}s have been deleted`,
            userId
          );
        }
      }

      logger.info(`Bulk delete notifications sent for ${count} ${documentType}s`);
    } catch (error) {
      logger.error('Failed to send bulk delete notifications:', error);
    }
  }

  /**
   * Helper: Notify all approvers
   */
  private async notifyApprovers(
    documentId: string,
    documentNo: string,
    documentType: string,
    excludeUserId: string,
    action: string,
    customMessage?: string
  ): Promise<void> {
    try {
      const document = await this.documentbService.getDocumentByTypeId(documentId);
      
      if (document && document.approvalFlow) {
        const approvers = await this.collectApprovers(document.approvalFlow, excludeUserId);
        
        const message = customMessage || 
          (action === 'created' 
            ? `New ${documentType} ${documentNo} requires your approval`
            : `${documentType} ${documentNo} has been ${action}`);

        for (const approverId of approvers) {
          await this.notificationService.createNoti(message, approverId);
        }

        logger.info(`Approver notifications sent for ${documentType} ${documentNo}`);
      }
    } catch (error) {
      logger.error('Failed to notify approvers:', error);
    }
  }

  /**
   * Helper: Collect all approver IDs
   */
  private async collectApprovers(approvalFlow: any, excludeUserId?: string): Promise<string[]> {
    const approvers: string[] = [];

    // Collect verifiers
    if (approvalFlow.verifiers && approvalFlow.verifiers.length > 0) {
      approvalFlow.verifiers.forEach((verifier: any) => {
        if (verifier.id && verifier.id !== excludeUserId) {
          approvers.push(verifier.id);
        }
      });
    }

    // Collect approvers from all levels
    if (approvalFlow.approvers) {
      const levels = [
        approvalFlow.approvers.firstApprover,
        approvalFlow.approvers.secondApprover,
        approvalFlow.approvers.thirdApprover
      ];

      levels.forEach((level: any) => {
        if (level && level.users && level.users.length > 0) {
          level.users.forEach((user: any) => {
            if (user.id && user.id !== excludeUserId) {
              approvers.push(user.id);
            }
          });
        }
      });
    }

    return approvers;
  }

  /**
   * Helper: Check if user is an approver
   */
  private async isUserApprover(userId: string, approvalFlow: any): Promise<boolean> {
    // Check verifiers
    if (approvalFlow.verifiers && approvalFlow.verifiers.length > 0) {
      if (approvalFlow.verifiers.some((v: any) => v.id === userId)) {
        return true;
      }
    }

    // Check approvers
    if (approvalFlow.approvers) {
      const levels = [
        approvalFlow.approvers.firstApprover,
        approvalFlow.approvers.secondApprover,
        approvalFlow.approvers.thirdApprover
      ];

      for (const level of levels) {
        if (level && level.users && level.users.length > 0) {
          if (level.users.some((u: any) => u.id === userId)) {
            return true;
          }
        }
      }
    }

    return false;
  }
}
