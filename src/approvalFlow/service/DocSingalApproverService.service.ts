import { inject, injectable } from "inversify";
import { DocumentStatus, DocumentTypeEnum } from "../entity/docuemnt.entity";
import { TYPES } from "../../types";

import { Brackets } from "typeorm";
import { UserRepository } from "../../employee/repository/user.repository";
import { ApproverStatus } from "../entity/approvalname.entity";
import { DocumentApprovalFlowRepository } from "../repository/DocumentApprovalFlowRepository.repository";
import { ApprovalStageInfoRepository } from "../repository/approvalStageInfoRepository";

import { buildQueryFromArray } from "../../utils/pagination";
import { DocumentbService } from "./documentb.service";
import { CacheService } from "../../global/cache.service";
import { PaginationOptions } from "../../utils/pagination";
import { applyDocumentFilters } from "../../global/filters/documentFilter.query";
import { getReadableDocumentType } from "../../utils/documentTypeLabel";
import logger from "../../utils/logger";
import { DocumentbRepository } from "../repository/documentb.repository";
import { NotificationService } from "../../notification/service/notification.service";
import { InventoryMovementService } from "../../inventoryStock/service/inventoryMovement.service";


@injectable()
export class DocSingalApproverService {
    constructor( @inject(TYPES.DocumentbRepository)
    private documentbRepository: DocumentbRepository,
    @inject(TYPES.UserRepository)
    private userRepository: UserRepository,
    @inject(TYPES.DocumentApprovalFlowRepository)
    private documentApprovalFlowRepository: DocumentApprovalFlowRepository,
    @inject(TYPES.ApprovalStageInfoRepository)
    private approvalStageInfoRepository: ApprovalStageInfoRepository,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.DocumentbService)
    private documentBService: DocumentbService,
    @inject(TYPES.CacheService)
    private cacheService: CacheService,
    @inject(TYPES.InventoryMovementService)
    private inventoryMovementService: InventoryMovementService,
  ){}

  // Convert document type to readable format — moved to src/utils/documentTypeLabel.ts
  
  private isSingleApprovalBasedDocument(type: DocumentTypeEnum): boolean {
    return [
      //Todo:Have To Add Some documentType...pending
      DocumentTypeEnum.RFPA,
      DocumentTypeEnum.DEAL_SLIP,
      DocumentTypeEnum.AQR,
      DocumentTypeEnum.INWARD_REGISTER,
      DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
    ].includes(type);
  }

  //Todo:New By Vaishali
  //TODO: Approve Document
  private async invalidateRelatedCache(type: DocumentTypeEnum, documentId?: string, documentTypeId?: string): Promise<void> {
    const prefixMap: Partial<Record<DocumentTypeEnum, string[]>> = {
      [DocumentTypeEnum.RFPA]: ['rfpa:list:*', 'rfpa:all:*', 'rfpa:rfpanumbers:*', 'rfpa:recycle:*'],
      [DocumentTypeEnum.DEAL_SLIP]: ['dealslip:list:*', 'dealslip:all:*', 'dealslip:nos:*'],
      [DocumentTypeEnum.AQR]: ['aqr:list:*', 'aqr:all:*', 'aqr:recycle:*'],
      [DocumentTypeEnum.INWARD_REGISTER]: ['iwr:list:*', 'iwr:all:*', 'iwr:recycle:*'],
      [DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER]: ['vehicleDispatch:list:*', 'vehicleDispatch:all:*', 'vehicleDispatch:recycle:*'],
    };
    const patterns = prefixMap[type] ?? [];
    const tasks: Promise<any>[] = patterns.map(p => this.cacheService.invalidatePattern(p));

    if (documentId) {
      tasks.push(
        this.cacheService.invalidatePattern(`singledoc:view:${documentId}:*`),
        this.cacheService.del(`doc:byid:${documentId}`),
      );
      // Module "view" caches are keyed by the Documentb id (the /view/:docid route
      // param), NOT by document_type_id — they must be busted with documentId.
      if (type === DocumentTypeEnum.INWARD_REGISTER) {
        tasks.push(this.cacheService.invalidatePattern(`iwr:view:${documentId}:*`));
      } else if (type === DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER) {
        tasks.push(this.cacheService.invalidatePattern(`vehicleDispatch:view:${documentId}:*`));
      }
    }

    // Bust per-document view/id/update caches
    if (documentTypeId) {
      if (type === DocumentTypeEnum.RFPA) {
        tasks.push(
          this.cacheService.del(`rfpa:view:${documentTypeId}`),
          this.cacheService.del(`rfpa:id:${documentTypeId}`),
          this.cacheService.del(`rfpa:update:${documentTypeId}`),
        );
      } else if (type === DocumentTypeEnum.DEAL_SLIP) {
        tasks.push(
          this.cacheService.del(`dealslip:view:${documentTypeId}`),
          this.cacheService.del(`dealslip:id:${documentTypeId}`),
          this.cacheService.del(`dealslip:update:${documentTypeId}`),
          ...(documentId ? [this.cacheService.del(`dealslip:docview:${documentId}`)] : []),
        );
      } else if (type === DocumentTypeEnum.AQR) {
        // AQR view key includes userId: aqr:view:{docid}:{userId} — use pattern to bust all users
        tasks.push(
          this.cacheService.invalidatePattern(`aqr:view:${documentTypeId}:*`),
          this.cacheService.del(`aqr:id:${documentTypeId}`),
          this.cacheService.del(`aqr:update:${documentTypeId}`),
        );
        // also bust by documentId (the document UUID used as docid in getAQRByIdForView)
        if (documentId) {
          tasks.push(this.cacheService.invalidatePattern(`aqr:view:${documentId}:*`));
        }
      } else if (type === DocumentTypeEnum.INWARD_REGISTER) {
        tasks.push(
          this.cacheService.del(`iwr:id:${documentTypeId}`),
          this.cacheService.del(`iwr:update:${documentTypeId}`),
        );
      } else if (type === DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER) {
        tasks.push(
          this.cacheService.del(`vehicleDispatch:id:${documentTypeId}`),
          this.cacheService.del(`vehicleDispatch:update:${documentTypeId}`),
        );
      }
    }

    await Promise.all(tasks);
  }

  async approveDocumentStepForSingleLevel(
    documentId: string,
    userId: string,
    action: ApproverStatus,
    reason?: string,
  ): Promise<void> {
    const document = await this.documentbRepository.findOne({
      where: { id: documentId },
      relations: [
        'approvalFlow',
        'approvalFlow.verifiers',
        'approvalFlow.approvers',
        'approvalFlow.approvers.firstApprover',
        'approvalFlow.approvers.firstApprover.users',
        'approvalFlow.approvers.secondApprover',
        'approvalFlow.approvers.secondApprover.users',
        'approvalFlow.approvers.thirdApprover',
        'approvalFlow.approvers.thirdApprover.users',
        'approvalFlow.approvers.fourthApprover',
        'approvalFlow.approvers.fourthApprover.users',
        'approvalFlow.approvers.fifthApprover',
        'approvalFlow.approvers.fifthApprover.users',
        'approvalFlow.approvers.sixthApprover',
        'approvalFlow.approvers.sixthApprover.users',
        'approvalFlow.finalizers',
        'approvalFlow.finalizers.firstFinalizers',
        'approvalFlow.finalizers.secondFinalizers',
        'lastActionBy',
      ],
    });

    if (!document || !document.approvalFlow) {
      throw new Error('Document or approval flow not found');
    }

    const now = new Date();
    const user = await this.userRepository.findOne({ where: { id: userId } });
    const userName = user ? `${user.firstName} ${user.lastName}` : 'Unknown';
    const { approvalFlow, approvalInfo, type } = document;

   
    //TODO  : 1) Single approval documents
    if (this.isSingleApprovalBasedDocument(type)) {
      logger.info("Inside isSingleApprovalBasedDocument block");
      
       // 🛡 ensure approvalInfo exists
  if (!document.approvalInfo) {
    const newApprovalInfo = this.documentApprovalFlowRepository.create({});
    document.approvalInfo = await this.documentApprovalFlowRepository.save(newApprovalInfo);
    await this.documentbRepository.save(document); // link it
  }
  const approvalInfo = document.approvalInfo;
      const block = approvalFlow.approvers.firstApprover;
      if (block && block.users.some((u) => u.id === userId)) {

        if(document.status===DocumentStatus.COMPLETE)
        {
          throw new Error(
            `Document already Approved  by your approver block`,
          );
        }
        if(document.status===DocumentStatus.REJECT)
        {
            throw new Error(
            `Document Is Already Rejected  by approver `,
          ); 
        }

        // Pre-flight the stock movement BEFORE anything is persisted.
        // Approving is what moves stock now, so if the movement is impossible
        // (e.g. the goods are no longer available) we must fail here, while the
        // action is still fully retryable — once the stage record is saved the
        // "already acted" guard would block a second attempt.
        if (action === 'approved') {
          await this.inventoryMovementService.assertMovementIsApplicable(document);
        }

        // Create and save stage info
        const stage = this.approvalStageInfoRepository.create({
          userId,
          userName: userName,
          status: action as ApproverStatus,
          reason: reason ?? '',
          statusChangedAt: now,
        });
        // Save stage info
        const savedStage = await this.approvalStageInfoRepository.save(stage);
        console.log("savedStage",savedStage);
        approvalInfo.firstApproved = savedStage;
        await this.documentApprovalFlowRepository.save(approvalInfo);

          const docNo = await this.documentBService.resolveDocumentTypeNo(document);
          const readableType = getReadableDocumentType(document.type);
          const docLabel = docNo ? `${readableType} #${docNo}` : readableType;

          if (action === 'reject') {
          const remark = `${document.type} Document Rejected By Approvers`;
          document.status = DocumentStatus.REJECT;
          document.remarks = remark;
          await this.documentbRepository.save(document);
          await this.invalidateRelatedCache(document.type, documentId, document.document_type_id ?? undefined);
          // 🔔 Creator
          if (document.lastActionBy?.id) {
            await this.notificationService.createNoti(
              `Your ${docLabel} was rejected at Approver Level 1 by ${userName}`,
              document.lastActionBy.id,
            );
          }
          // 🔔 Same-stage peers — batch notification
          const rejectPeerIds = (block.users ?? []).filter(u => u.id !== userId).map(u => u.id);
          if (rejectPeerIds.length > 0) {
            await this.notificationService.createBatchNoti(
              `${docLabel} was rejected at Approver Level 1 by ${userName}. No action needed from you`,
              rejectPeerIds
            );
          }
        } else if (action === 'approved') {
          const remark = `${document.type} Document Approved By Approvers`;
          document.status = DocumentStatus.COMPLETE;
          document.remarks = remark;
          // Persists the status AND applies this document's stock movement in a
          // single transaction, guarded by documents.inventoryProcessed so a
          // repeated or concurrent approval cannot move stock twice.
          await this.inventoryMovementService.completeDocumentWithInventory(document);
          await this.invalidateRelatedCache(document.type, documentId, document.document_type_id ?? undefined);

          // 🔔 Actor
          await this.notificationService.createNoti(`You approved ${docLabel} at Approver Level 1`, userId);
          // 🔔 Creator
          if (document.lastActionBy?.id) {
            await this.notificationService.createNoti(
              `Your ${docLabel} was approved at Approver Level 1 by ${userName}. Document is now Complete`,
              document.lastActionBy.id,
            );
          }
          // 🔔 Same-stage peers — batch notification
          const approvePeerIds = (block.users ?? []).filter(u => u.id !== userId).map(u => u.id);
          if (approvePeerIds.length > 0) {
            await this.notificationService.createBatchNoti(
              `${docLabel} has already been approved at Approver Level 1 by ${userName}. No action needed from you`,
              approvePeerIds
            );
          }
        }

        return;
      }
    }

    throw new Error(
      'User is not authorized to act on this document at this stage',
    );
  }

    //Todo:By Vaishali....17-07-2025
    //Todo:get All Single Approval Documents By UserId
    public async getAllSingleApprovalDocumentsByUserId(
      userId: string,
      documentType: string,
      includeDeleted: boolean = false,
      queryOptions?: PaginationOptions,
    ): Promise<any> {
      if (!Object.values(DocumentTypeEnum).includes(documentType as DocumentTypeEnum)) {
        throw new Error(`Invalid document type: ${documentType}`);
      }
    
      const queryBuilder = this.documentbRepository
        .createQueryBuilder('document')
        .leftJoinAndSelect('document.approvalFlow', 'approvalFlow')
        .leftJoinAndSelect('approvalFlow.approvers', 'approvalLevel')
        .leftJoinAndSelect('approvalLevel.firstApprover', 'firstApproverBlock')
        .leftJoinAndSelect('firstApproverBlock.users', 'firstApproverUser')
        .leftJoinAndSelect('document.lastActionBy', 'lastActionBy')
        .where('document.type = :documentType', { documentType })
        .andWhere('document.document_type_id IS NOT NULL')
        .andWhere('document.isDeleted = :isDeleted', { isDeleted: includeDeleted })
        .andWhere(includeDeleted ? 'document.deletedAt IS NOT NULL' : 'document.deletedAt IS NULL')
        .andWhere(
          new Brackets((qb) => {
            qb.where('firstApproverUser.id = :userId', { userId })
              .orWhere('lastActionBy.id = :userId', { userId });
        }),
        );
    
      // Document filters run here, in SQL, inside the visibility rules above. Callers
      // that pass none keep the previous (unordered, unfiltered) behaviour.
      if (queryOptions?.documentFilters) {
        const sorted = applyDocumentFilters(queryBuilder, queryOptions.documentFilters, { documentAlias: 'document' });
        if (!sorted) queryBuilder.orderBy('document.createdAt', 'DESC');
      }

      const [data, total] = await queryBuilder.getManyAndCount();
      console.log('Fetched single-level documents:', data ,total);
      return data;
    }
    
//Todo:By Vaishali....17-07-2025

//TODO: Only creator or first-level approvers can see single-approval document
//TODO:get Single Approval Document ById
async getSingleApprovalDocumentById(documentId: string, userId: string): Promise<any> {
  const cacheKey = `singledoc:view:${documentId}:${userId}`;
  const cached = await this.cacheService.get<any>(cacheKey);
  if (cached) return cached;

  try {
    // Tight query — only join lastActionBy, approvalInfo, firstApproved.
    // No approvalFlow/creator/verifier/thirdApproved/finalizer joins so they
    // can never leak into the response.
    const document = await this.documentbRepository
      .createQueryBuilder('document')
      .leftJoin('document.lastActionBy', 'lastActionBy')
      .leftJoin('document.approvalFlow', 'approvalFlow')
      .leftJoin('approvalFlow.approvers', 'approvalLevel')
      .leftJoin('approvalLevel.firstApprover', 'firstApproverBlock')
      .leftJoin('firstApproverBlock.users', 'firstApproverUser')
      .leftJoin('document.approvalInfo', 'approvalInfo')
      .leftJoin('approvalInfo.firstApproved', 'firstApproved')
      .select([
        'document.id',
        'document.document_type_id',
        'document.status',
        'document.createdAt',
        // lastActionBy — need id for access check + name for response
        'lastActionBy.id',
        'lastActionBy.firstName',
        'lastActionBy.lastName',
        // approvalFlow approvers — only to check if userId is a first-level approver
        'approvalFlow.id',
        'approvalLevel.id',
        'firstApproverBlock.id',
        'firstApproverUser.id',
        // approvalInfo — only firstApproved stage
        'approvalInfo.id',
        'firstApproved.userId',
        'firstApproved.userName',
        'firstApproved.status',
        'firstApproved.reason',
      ])
      .where('document.id = :documentId', { documentId })
      .getOne();

    if (!document) {
      throw new Error(`Document with ID ${documentId} not found`);
    }

    const isCreator = document.lastActionBy?.id === userId;
    const firstLevelUsers = document.approvalFlow?.approvers?.firstApprover?.users ?? [];
    const isFirstApprover = firstLevelUsers.some((u: any) => u.id === userId);

    if (!isCreator && !isFirstApprover) {
      return null;
    }

    const approvalInfo = document.approvalInfo;

    const result = {
      documentId: document.id,
      documentTypeId: document.document_type_id,
      status: document.status,
      overAllStatus: document.status,
      createdAt: document.createdAt,
      lastActionBy: document.lastActionBy ?? null,
      createdBy: document.lastActionBy
        ? `${document.lastActionBy.firstName} ${document.lastActionBy.lastName}`
        : null,
      approvalSummary: {
        createdBy: document.lastActionBy
          ? {
              userId: document.lastActionBy.id,
              name: `${document.lastActionBy.firstName} ${document.lastActionBy.lastName}`.trim(),
            }
          : null,
        firstApproved: approvalInfo?.firstApproved
          ? {
              userId: approvalInfo.firstApproved.userId,
              name: approvalInfo.firstApproved.userName,
              status: approvalInfo.firstApproved.status,
              reason: approvalInfo.firstApproved.reason ?? null,
            }
          : null,
      },
    };

    await this.cacheService.set(cacheKey, result, 30);
    return result;
  } catch (error) {
    throw new Error(`Error fetching single-approval document: ${error}`);
  }
}

}