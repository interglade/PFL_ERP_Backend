//TODO: This service is replica of documentb.service.ts. 'documentb.service.ts' will be used for multiple level approval like grns and voucher.
//TODO: This service will be used for single level approval like deal slips, rfpa, etc.

import { inject, injectable } from "inversify";

import { TYPES } from "../../types";
import { UserRepository } from "../../employee/repository/user.repository";

import { ApprovalStageInfoRepository } from "../repository/approvalStageInfoRepository";
import { DocumentApprovalFlowRepository } from "../repository/DocumentApprovalFlowRepository.repository";
import { ApproverStatus } from "../entity/approvalname.entity";
import { DocumentStatus, DocumentTypeEnum } from "../entity/docuemnt.entity";
import { PaginationOptions } from "../../utils/pagination";
import { Brackets } from "typeorm";
import { DocumentbService } from "./documentb.service";
import { getReadableDocumentType } from "../../utils/documentTypeLabel";
import { CacheService } from "../../global/cache.service";
import { applyDocumentFilters, safeSqlSort } from "../../global/filters/documentFilter.query";
import { NotificationService } from "../../notification/service/notification.service";
import { DocumentbRepository } from "../repository/documentb.repository";
import { InventoryMovementService } from "../../inventoryStock/service/inventoryMovement.service";

@injectable()
export class DocDoubleApproverService {

  constructor(
    @inject(TYPES.DocumentbRepository) private documentbRepository: DocumentbRepository,
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
    @inject(TYPES.NotificationService) private notificationService: NotificationService,
    @inject(TYPES.ApprovalStageInfoRepository) private approvalStageInfoRepository: ApprovalStageInfoRepository,
    @inject(TYPES.DocumentApprovalFlowRepository) private documentApprovalFlowRepository: DocumentApprovalFlowRepository,
    @inject(TYPES.DocumentbService) private documentBService: DocumentbService,
    @inject(TYPES.CacheService) private cacheService: CacheService,
    @inject(TYPES.InventoryMovementService) private inventoryMovementService: InventoryMovementService,
  ) {
  }

  // Invalidate all caches that depend on a document's status.
  // Accepts the document so it can bust the correct module's cache keys.
  private async invalidateDocumentCache(documentId: string, document?: any): Promise<void> {
    const typeId = document?.document_type_id;
    const type: DocumentTypeEnum | undefined = document?.type;

    // Per-type cache prefix map — mirrors the bustDocCache map in documentb.service.ts
    const prefixMap: Partial<Record<DocumentTypeEnum, string[]>> = {
      [DocumentTypeEnum.FINAL_INVOICE]: [
        'finv:list:*', 'finv:all:*', 'finv:recycle:*',
        ...(typeId ? [`finv:id:${typeId}`, `finv:view:${typeId}`, `finv:update:${typeId}`] : []),
        `finv:view:${documentId}`,
      ],
      [DocumentTypeEnum.RETURN_TO_VENDOR]: [
        'returnToVendor:list:*', 'returnToVendor:all:*', 'returnToVendor:recycle:*',
        ...(typeId ? [
          `returnToVendor:id:${typeId}`,
          `returnToVendor:view:${typeId}`,
          `returnToVendor:update:${typeId}`,
        ] : []),
        `returnToVendor:view:${documentId}`,
      ],
      [DocumentTypeEnum.RETURN_BY_CUSTOMER]: [
        'rbc:list:*', 'rbc:all:*', 'rbc:recycle:*',
        ...(typeId ? [`rbc:id:${typeId}`, `rbc:view:${typeId}`, `rbc:update:${typeId}`] : []),
        `rbc:view:${documentId}`, `rbc:update:${documentId}`, `rbc:id:${documentId}`,
      ],
      [DocumentTypeEnum.SECOND_SALE]: [
        'secondSale:list:*', 'secondSale:all:*', 'secondSale:recycle:*',
        ...(typeId ? [`secondSale:id:${typeId}`, `secondSale:update:${typeId}`] : []),
        `secondSale:view:${documentId}`,
      ],
      [DocumentTypeEnum.DC_TYPE_CUSTOMER]: [
        'cdc:list:*', 'cdc:all:*', 'cdc:recycle:*',
        ...(typeId ? [`cdc:id:${typeId}`, `cdc:update:${typeId}`] : []),
        `cdc:view:${documentId}`,
      ],
      [DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER]: [
        'stockTransferChallan:list:*', 'stockTransferChallan:all:*',
        ...(typeId ? [`stockTransferChallan:id:${typeId}`, `stockTransferChallan:update:${typeId}`] : []),
        `stockTransferChallan:view:${documentId}`,
      ],
      [DocumentTypeEnum.DC_TYPE_OTHER]: [
        'odc:list:*', 'odc:all:*',
        ...(typeId ? [`odc:id:${typeId}`, `odc:update:${typeId}`] : []),
        `odc:view:${documentId}`,
      ],
      [DocumentTypeEnum.DUMP_REGISTER]: [
        'dump:list:*', 'dump:all:*', 'dump:recycle:*',
        ...(typeId ? [`dump:id:${typeId}`, `dump:update:${typeId}`] : []),
        `dump:view:${documentId}`,
      ],
      [DocumentTypeEnum.MULTI_CASH_VOUCHER]: [
        'mcv:list:*', 'mcv:all:*', 'mcv:recycle:*',
        ...(typeId ? [`mcv:id:${typeId}`, `mcv:update:${typeId}`] : []),
        `mcv:view:${documentId}`,
      ],
      [DocumentTypeEnum.LABOR_PAYMENT_VOUCHER]: [
        'lpv:list:*', 'lpv:all:*', 'lpv:recycle:*',
        ...(typeId ? [`lpv:id:${typeId}`, `lpv:update:${typeId}`] : []),
        `lpv:view:${documentId}`,
      ],
      [DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER]: [
        'tpVoucher:list:*', 'tpVoucher:all:*', 'tpVoucher:recycle:*',
        ...(typeId ? [`tpVoucher:id:${typeId}`, `tpVoucher:update:${typeId}`] : []),
        `tpVoucher:view:${documentId}`,
      ],
      [DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER]: [
        'pmpv:list:*', 'pmpv:all:*', 'pmpv:recycle:*',
        ...(typeId ? [`pmpv:id:${typeId}`, `pmpv:update:${typeId}`] : []),
        `pmpv:view:${documentId}`,
      ],
      [DocumentTypeEnum.EOD_REPORT]: [],
    };

    const keys = type ? (prefixMap[type] ?? []) : [];
    const tasks: Promise<any>[] = [this.cacheService.del(`doc:byid:${documentId}`)];
    for (const key of keys) {
      if (key.endsWith(':*')) {
        tasks.push(this.cacheService.invalidatePattern(key));
      } else {
        tasks.push(this.cacheService.del(key));
      }
    }
    await Promise.all(tasks);
  }

  // Convert document type to readable format — moved to src/utils/documentTypeLabel.ts

  async approveDocumentStepForDoubleLevel(
  documentId: string,
  userId: string,
  action: ApproverStatus,
  reason?: string,
): Promise<void> {
  const document = await this.documentbRepository.findOne({
    where: { id: documentId },
    relations: [
      'approvalFlow',
      'approvalFlow.approvers',
      'approvalFlow.approvers.firstApprover',
      'approvalFlow.approvers.firstApprover.users',
      'approvalFlow.approvers.secondApprover',
      'approvalFlow.approvers.secondApprover.users',
       'approvalInfo',
       'approvalInfo.firstApproved',
        'approvalInfo.secondApproved',
      'lastActionBy',
    ],
  });

  if (!document || !document.approvalFlow) {
    throw new Error('Document or its approval flow not found');
  }

  const now = new Date();
  const user = await this.userRepository.findOne({ where: { id: userId } });
  const userName = user ? `${user.firstName} ${user.lastName}` : 'Unknown';

  // Ensure approvalInfo exists
  if (!document.approvalInfo) {
    document.approvalInfo = await this.documentApprovalFlowRepository.save(
      this.documentApprovalFlowRepository.create()
    );
    await this.documentbRepository.save(document);
  }

  const info = document.approvalInfo;
  const flow = document.approvalFlow;
  const firstBlock = flow.approvers.firstApprover;
  const secondBlock = flow.approvers.secondApprover;

  const isFirstApprover = firstBlock?.users?.some(u => u.id === userId);
  const isSecondApprover = secondBlock?.users?.some(u => u.id === userId);

  if (!isFirstApprover && !isSecondApprover) {
    throw new Error('User is not authorized to act on this document');
  }

  // Terminal-state guard. Without this, a document already at COMPLETE could be
  // driven through the approval branch again — which, now that inventory is
  // applied here, would be an attempt at a second stock movement.
  if (document.status === DocumentStatus.COMPLETE) {
    throw new Error('Document is already fully approved');
  }
  if (document.status === DocumentStatus.REJECT) {
    throw new Error('Document is already rejected');
  }

  // REJECTED handling (immediate)
  if (action === ApproverStatus.REJECTED) {
    const stage = await this.approvalStageInfoRepository.save({
      userId,
      userName,
      status: action,
      reason: reason ?? '',
      statusChangedAt: now,
    });

    if (isFirstApprover) {
      if (info.firstApproved) throw new Error('First approver already acted');
      info.firstApproved = stage;
      document.remarks = `${document.type} Rejected at Approver Level 1`;
    } else if (isSecondApprover) {
      if (info.secondApproved) throw new Error('Second approver already acted');
      info.secondApproved = stage;
      document.remarks = `${document.type} Rejected at Approver Level 2`;
    }

    document.status = DocumentStatus.REJECT;
    await this.documentApprovalFlowRepository.save(info);
    await this.documentbRepository.save(document);
    await this.invalidateDocumentCache(documentId, document);

    const docNo = await this.documentBService.resolveDocumentTypeNo(document);
    const readableType = getReadableDocumentType(document.type);
    const docLabel = docNo ? `${readableType} #${docNo}` : readableType;
    const rejectedLevel = isFirstApprover ? 'Approver Level 1' : 'Approver Level 2';
    const rejectedLevelUsers = isFirstApprover ? firstBlock?.users ?? [] : secondBlock?.users ?? [];
    const otherLevelUsersOnReject = isFirstApprover ? secondBlock?.users ?? [] : firstBlock?.users ?? [];

    // 🔔 Actor
    await this.notificationService.createNoti(`You rejected ${docLabel} at ${rejectedLevel}`, userId);
    // 🔔 Creator
    if (document.lastActionBy?.id) {
      await this.notificationService.createNoti(
        `Your ${docLabel} was rejected at ${rejectedLevel} by ${userName}`,
        document.lastActionBy.id,
      );
    }
    // 🔔 Same-stage peers + Other level approvers — batch notification
    const rejectNotifyUserIds = [
      ...rejectedLevelUsers.filter(u => u.id !== userId).map(u => u.id),
      ...otherLevelUsersOnReject.map(u => u.id),
    ];
    if (rejectNotifyUserIds.length > 0) {
      await this.notificationService.createBatchNoti(
        `${docLabel} was rejected at ${rejectedLevel} by ${userName}. No action needed from you`,
        rejectNotifyUserIds
      );
    }
    return;
  }

  // APPROVED handling
  if (action === ApproverStatus.APPROVED) {
    // Pre-flight the stock movement BEFORE anything is persisted. Approving is
    // what moves stock now, so if the movement is impossible (e.g. the goods
    // have been consumed since the document was raised) we must fail here,
    // while the action is still fully retryable — once the stage record is
    // saved the "approver already acted" guard would block a second attempt.
    // This action completes the document only if the OTHER level has already
    // approved — mirroring the completion check further down.
    const otherLevelApproved = isFirstApprover
      ? info.secondApproved?.status === ApproverStatus.APPROVED
      : info.firstApproved?.status === ApproverStatus.APPROVED;

    if (otherLevelApproved) {
      await this.inventoryMovementService.assertMovementIsApplicable(document);
    }

    const stage = await this.approvalStageInfoRepository.save({
      userId,
      userName,
      status: action,
      reason: reason ?? '',
      statusChangedAt: now,
    });

    if (isFirstApprover) {
      if (info.firstApproved) throw new Error('First approver already acted');
      info.firstApproved = stage;
    } else if (isSecondApprover) {
      if (info.secondApproved) throw new Error('Second approver already acted');
      info.secondApproved = stage;
    }

    await this.documentApprovalFlowRepository.save(info);

    const docNo2 = await this.documentBService.resolveDocumentTypeNo(document);
    const readableType2 = getReadableDocumentType(document.type);
    const docLabel2 = docNo2 ? `${readableType2} #${docNo2}` : readableType2;
    const approvedLevel = isFirstApprover ? 'Approver Level 1' : 'Approver Level 2';
    const approvedLevelUsers = isFirstApprover ? firstBlock?.users ?? [] : secondBlock?.users ?? [];
    const otherLevelUsers = isFirstApprover ? secondBlock?.users ?? [] : firstBlock?.users ?? [];

    // Invalidate cache on every approval action (approvalSummary changes)
    await this.invalidateDocumentCache(documentId, document);

    // Check if both levels approved
    const firstApproved = info.firstApproved?.status === ApproverStatus.APPROVED;
    const secondApproved = info.secondApproved?.status === ApproverStatus.APPROVED;

    if (firstApproved && secondApproved) {
      document.status = DocumentStatus.COMPLETE;
      document.remarks = `${document.type} Approved by Required Approvers`;
      // Persists the status AND applies this document's stock movement in a
      // single transaction, guarded by documents.inventoryProcessed so a
      // repeated or concurrent approval cannot move stock twice.
      await this.inventoryMovementService.completeDocumentWithInventory(document);
      await this.invalidateDocumentCache(documentId, document);

      // 🔔 Actor
      await this.notificationService.createNoti(`You approved ${docLabel2} at ${approvedLevel}`, userId);
      // 🔔 Creator
      if (document.lastActionBy?.id) {
        await this.notificationService.createNoti(
          `Your ${docLabel2} was approved at ${approvedLevel} by ${userName}. Document is now Complete`,
          document.lastActionBy.id,
        );
      }
      // 🔔 Same-stage peers + Other level approvers — batch notification
      const approveCompleteUserIds = [
        ...approvedLevelUsers.filter(u => u.id !== userId).map(u => u.id),
        ...otherLevelUsers.map(u => u.id),
      ];
      if (approveCompleteUserIds.length > 0) {
        await this.notificationService.createBatchNoti(
          `${docLabel2} has been fully approved by ${userName}. Document is now Complete`,
          approveCompleteUserIds
        );
      }
    } else {
      const nextStage = isFirstApprover ? 'Approver Level 2' : 'Approver Level 1';
      // 🔔 Actor
      await this.notificationService.createNoti(`You approved ${docLabel2} at ${approvedLevel}`, userId);
      // 🔔 Creator
      if (document.lastActionBy?.id) {
        await this.notificationService.createNoti(
          `Your ${docLabel2} was approved at ${approvedLevel} by ${userName}. Now waiting for ${nextStage}`,
          document.lastActionBy.id,
        );
      }
      // 🔔 Same-stage peers — batch notification
      const sameStagePeerIds = approvedLevelUsers.filter(u => u.id !== userId).map(u => u.id);
      if (sameStagePeerIds.length > 0) {
        await this.notificationService.createBatchNoti(
          `${docLabel2} has already been approved at ${approvedLevel} by ${userName}. No action needed from you`,
          sameStagePeerIds
        );
      }
      // 🔔 Next level approvers — batch notification
      const nextLevelUserIds = otherLevelUsers.map(u => u.id);
      if (nextLevelUserIds.length > 0) {
        await this.notificationService.createBatchNoti(
          `${docLabel2} has been approved at ${approvedLevel} by ${userName}. Your approval is now required at ${nextStage}`,
          nextLevelUserIds
        );
      }
    }

    return;
  }

  throw new Error('Invalid approval action');
}



  //TODO: Get Document with Data
  public async getAllDocumentByUserIdForDoubleApprover(userId: string, documentType: string, queryOptions: PaginationOptions, includeDeleted: boolean = false): Promise<any> {
    if (!Object.values(DocumentTypeEnum).includes(documentType as DocumentTypeEnum)) {
      throw new Error(`Invalid document type: ${documentType}`);
    }

    const queryBuilder = this.documentbRepository
      .createQueryBuilder('document')
      .leftJoin('document.approvalFlow', 'approvalFlow')
      .leftJoin('approvalFlow.approvers', 'approvalLevel')
      .leftJoin('approvalLevel.firstApprover', 'firstApproverBlock')
      .leftJoin('firstApproverBlock.users', 'firstApproverUser')
      .leftJoin('approvalLevel.secondApprover', 'secondApproverBlock')
      .leftJoin('secondApproverBlock.users', 'secondApproverUser')
      .leftJoin('document.lastActionBy', 'lastActionBy')
      .select([
        'document.id', 'document.document_type_id', 'document.type',
        'document.status', 'document.isDeleted', 'document.deletedAt', 'document.createdAt',
        'lastActionBy.id', 'lastActionBy.firstName', 'lastActionBy.lastName',
      ])
      .where(
        new Brackets((qb) => {
          qb.orWhere('firstApproverUser.id = :userId', { userId })
            .orWhere('secondApproverUser.id = :userId', { userId })
            .orWhere('lastActionBy.id = :userId', { userId });
        }),
      )
      .andWhere('document.document_type_id IS NOT NULL')
      .andWhere('document.type = :documentType', { documentType })
      .andWhere('document.isDeleted = :isDeleted', { isDeleted: includeDeleted })
      .andWhere(includeDeleted ? 'document.deletedAt IS NOT NULL' : 'document.deletedAt IS NULL');

    // Document filters (dates, status, parties, products, search, ...) run here, in SQL,
    // inside the visibility rules above and before pagination.
    const sorted = applyDocumentFilters(queryBuilder, queryOptions?.documentFilters, { documentAlias: 'document' });
    if (!sorted) {
      // A raw sort string is only honoured as a plain column on the document query.
      const [sortField, sortOrder] = safeSqlSort(queryOptions?.sort, ['document', 'lastActionBy'], ['document.createdAt', 'DESC']);
      queryBuilder.orderBy(sortField, sortOrder);
    }

    const page = queryOptions?.page || 1;
    const limit = queryOptions?.limit || 10;
    queryBuilder.skip((page - 1) * limit).take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      meta: { total, page, pages: Math.ceil(total / limit) },
    };
  }

  //TODO: For View — double-level approval only (firstApproved + secondApproved)
  async getDocumentById(id: string): Promise<any> {
    const document = await this.documentbRepository
      .createQueryBuilder('document')
      .leftJoin('document.lastActionBy', 'lastActionBy')
      .leftJoin('document.approvalInfo', 'approvalInfo')
      .leftJoin('approvalInfo.firstApproved', 'firstApproved')
      .leftJoin('approvalInfo.secondApproved', 'secondApproved')
      .select([
        'document.id',
        'document.document_type_id',
        'document.status',
        'document.createdAt',
        'lastActionBy.id',
        'lastActionBy.firstName',
        'lastActionBy.lastName',
        'approvalInfo.id',
        'firstApproved.userId',
        'firstApproved.userName',
        'firstApproved.status',
        'firstApproved.reason',
        'secondApproved.userId',
        'secondApproved.userName',
        'secondApproved.status',
        'secondApproved.reason',
      ])
      .where('document.id = :id', { id })
      .getOne();

    if (!document) throw new Error(`Document with ID ${id} not found`);

    const a = document.approvalInfo;
    const mapStage = (stage: any) =>
      stage
        ? {
            userId: stage.userId,
            name: stage.userName,
            status: stage.status,
            reason: stage.reason ?? null,
          }
        : null;

    return {
      documentId: document.id,
      documentTypeId: document.document_type_id,
      status: document.status,
      overAllStatus: document.status,
      createdAt: document.createdAt,
      lastActionBy: document.lastActionBy ?? null,
      approvalSummary: {
        createdBy: document.lastActionBy
          ? {
              userId: document.lastActionBy.id,
              name: `${document.lastActionBy.firstName} ${document.lastActionBy.lastName}`.trim(),
            }
          : null,
        firstApproved: mapStage(a?.firstApproved ?? null),
        secondApproved: mapStage(a?.secondApproved ?? null),
      },
    };
  }


}