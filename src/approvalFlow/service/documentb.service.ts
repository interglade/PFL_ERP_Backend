import { inject, injectable } from 'inversify';
import { TYPES } from '../../types';

import { Documentb, DocumentStatus, DocumentTypeEnum } from '../entity/docuemnt.entity';
import { ApprovalFlowRepository } from '../repository/approvalFlow.repository';

import { ApprovalLevel } from '../entity/approvalLevel.entity';

import { ApproverStatus } from '../entity/approvalname.entity';
import { ApprovalStageInfoRepository } from '../repository/approvalStageInfoRepository';

import { DocumentApprovalFlowRepository } from '../repository/DocumentApprovalFlowRepository.repository';

import { DealSlipRepository } from '../../dealSlip/repository/dealSlip.repository';
import { log } from 'node:console';
import { UserRepository } from '../../employee/repository/user.repository';

import { SecondSaleRepository } from '../../secondSale/repository/secondSale.repository';
import { VehicleDispatchRepository } from '../../vehicleDispatch/repository/vehicleDispatch.repository';
import { DumpRegisterRepository } from '../../dumpRegister/repository/dumpRegister.repository';
import { InwardRepository } from '../../inwardRegister/repository/inwardRegister.repository';
import { OtherDeliveryChallanRepository } from '../../deliveryChallans/otherDeliveryChallan/repository/otherDeliveryChallan.repository';
import { StockTransferDeliveryChallanRepository } from '../../deliveryChallans/stockTransferDC/repository/stockTransferDeliveryChallan.repository';
import { CustomerDeliveryChallanRepository } from '../../deliveryChallans/customerDeliveryChllan/repository/customerDeliveryChallan.repository';

import { ReturnToVendorRepository } from '../../returnToVendor/repository/returnToVendor.repository';
import { buildQuery, PaginationOptions } from '../../utils/pagination';
import { getReadableDocumentType } from '../../utils/documentTypeLabel';
import { CacheService } from '../../global/cache.service';
import { ParsedQs } from 'qs';
import { Brackets } from 'typeorm';
import e from 'express';
import logger from '../../utils/logger';
import { DocumentbRepository } from '../repository/documentb.repository';
import { applyDocumentFilters, safeSqlSort } from '../../global/filters/documentFilter.query';
import { NotificationService } from '../../notification/service/notification.service';
import { GrnRepository } from '../../grn/repository/grn.repository';
import { RfpaRepository } from '../../rfpa/repository/rfpa.repository';
import { MultiCashVoucherRepository } from '../../vouchers/multiCashV/repository/multicashVoucher.repository';
import { LabourPaymentVoucherRepository } from '../../vouchers/labourPaymentV/repository/labourPaymentVoucher.repository';
import { AqrRepository } from '../../aqr/repository/aqr.repository';
import { PostReturnByCustomerRepository } from '../../returnByCustomer/repository/postReturnByCustomer.repository';
import { ApproverBlock } from '../entity/approvalBlock.entity';
import { User } from '../../employee/entity/user.entity';

export interface DocumentWithRelatedData extends Documentb {
  relatedData?: any;
}

@injectable()
export class DocumentbService {
  constructor(
    @inject(TYPES.DocumentbRepository)
    private documentbRepository: DocumentbRepository,
    @inject(TYPES.ApprovalFlowRepository)
    private approvalFlowRepo: ApprovalFlowRepository,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.ApprovalStageInfoRepository)
    private approvalStageInfoRepository: ApprovalStageInfoRepository,
    @inject(TYPES.GrnRepository) private readonly grnRepository: GrnRepository,
    @inject(TYPES.DocumentApprovalFlowRepository)
    private documentApprovalFlowRepository: DocumentApprovalFlowRepository,
    @inject(TYPES.RfpaRepository)
    private rfpaRepository: RfpaRepository, // Replace with actual type
    @inject(TYPES.DealSlipRepository)
    private dealSlipRepository: DealSlipRepository, // Replace with actual type
    @inject(TYPES.UserRepository) private userRepository: UserRepository,
    @inject(TYPES.MultiCashVoucherRepository)
    private cashVoucherRepository: MultiCashVoucherRepository,
    @inject(TYPES.LabourPaymentVoucherRepository)
    private lpVoucherRepository: LabourPaymentVoucherRepository,
    @inject(TYPES.AqrRepository)
    private aqrRepository: AqrRepository,
    @inject(TYPES.SecondSaleRepository)
    private secondSaleRepository: SecondSaleRepository,
    @inject(TYPES.VehicleDispatchRepository)
    private vehicleDispatchRepository: VehicleDispatchRepository,
    @inject(TYPES.DumpRegisterRepository)
    private dumpRegisterRepository: DumpRegisterRepository,
    @inject(TYPES.InwardRepository)
    private inwardRepository: InwardRepository,
    @inject(TYPES.OtherDeliveryChallanRepository)
    private otherDCRepository: OtherDeliveryChallanRepository,
    @inject(TYPES.StockTransferDeliveryChallanRepository)
    private stockTransferDCRepository: StockTransferDeliveryChallanRepository,
    @inject(TYPES.CustomerDeliveryChallanRepository)
    private customerDCRepository: CustomerDeliveryChallanRepository,
    @inject(TYPES.PostReturnByCustomerRepository)
    private rbcRepository: PostReturnByCustomerRepository,
    @inject(TYPES.ReturnToVendorRepository)
    private rtvRepository: ReturnToVendorRepository,
    @inject(TYPES.CacheService)
    private cacheService: CacheService,
  ) { }

  private userCache: Map<string, { firstName: string; lastName: string }> = new Map();

  private async getCachedUser(userId: string): Promise<string> {
    if (this.userCache.has(userId)) {
      const user = this.userCache.get(userId)!;
      return `${user.firstName} ${user.lastName}`;
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    const userName = user ? `${user.firstName} ${user.lastName}` : 'Unknown';
    
    if (user) {
      this.userCache.set(userId, { firstName: user.firstName, lastName: user.lastName });
    }
    
    return userName;
  }

  private isSingleApprovalBasedDocument(type: DocumentTypeEnum): boolean {
    return [
      DocumentTypeEnum.RFPA,
      DocumentTypeEnum.DEAL_SLIP,
      DocumentTypeEnum.AQR,
      DocumentTypeEnum.INWARD_REGISTER,
      DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
    ].includes(type);
  }
  private isDoubleApprovalBasedDocument(type: DocumentTypeEnum): boolean {
    return [
      DocumentTypeEnum.DC_TYPE_CUSTOMER,
      DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER,
      DocumentTypeEnum.DC_TYPE_OTHER,
      DocumentTypeEnum.LABOR_PAYMENT_VOUCHER,
      DocumentTypeEnum.MULTI_CASH_VOUCHER,
      DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER,
      DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER,
      DocumentTypeEnum.DUMP_REGISTER,
      DocumentTypeEnum.FINAL_INVOICE,
      DocumentTypeEnum.RETURN_TO_VENDOR,
      DocumentTypeEnum.RETURN_BY_CUSTOMER,
      DocumentTypeEnum.SECOND_SALE,
      DocumentTypeEnum.EOD_REPORT,
    ].includes(type);
  }

  private isVerifierBasedDocument(type: DocumentTypeEnum): boolean {
    return [
      DocumentTypeEnum.GRN,
      DocumentTypeEnum.LABOR_PAYMENT_VOUCHER,
      DocumentTypeEnum.MULTI_CASH_VOUCHER,
      DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER,
      DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER,
    ].includes(type);
  }

  async createDocument(documentData: any,/* approvalFlow: any*/): Promise<any> {
    try {

      const lastActionByUser = documentData.lastActionBy;
      
      if (!lastActionByUser || !lastActionByUser.id) {
        throw new Error(
          'lastActionBy user is required to fetch approval flow.',
        );
      }

  

      const approvalFlow = await this.approvalFlowRepo.findOne({
        where: {
          creator: { id: lastActionByUser.id },
          type: documentData.docDef,
        },
        relations: [
          'verifiers',
          'approvers',
          'approvers.firstApprover',
          'approvers.secondApprover',
          'approvers.thirdApprover',
          'approvers.fourthApprover',
          'approvers.fifthApprover',
          'approvers.sixthApprover',
        ],
      });

      

      const document = this.documentbRepository.create({
        ...documentData,
        ...(approvalFlow && { approvalFlow })
      });

      const savedDocument = await this.documentbRepository.save(document);

      return savedDocument;
    } catch (error) {
      throw new Error(`Error creating document: ${error}`);
    }
  }

  async getDocumentById(id: string): Promise<any> {
    try {
      const cacheKey = `doc:byid:${id}`;
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) return cached;

      const document = await this.documentbRepository.findOne({
        where: { id },
        relations: [
          'lastActionBy',
          'approvalInfo',
          'approvalInfo.firstFinalized',
          'approvalInfo.secondFinalized',
          'approvalInfo.firstApproved',
          'approvalInfo.secondApproved',
          'approvalInfo.thirdApproved',
          'approvalInfo.verified',
        ],
        order: { createdAt: 'DESC' },
      });

      if (!document) {
        throw new Error(`Document with ID ${id} not found`);
      }
     

      const approvalInfo = document.approvalInfo;
      // Prefer createdBy stored on approvalInfo; fall back to approvalFlow.creator for older records
     
      // When status is 'hold', approvalInfo is null (not yet created).
      // Still return approvalSummary with createdBy so the frontend always has creator info.
      const approvalInfoSummary = {
        createdBy: document.lastActionBy
          ? {
              userId: document.lastActionBy?.id,
              name: `${document.lastActionBy.firstName} ${document.lastActionBy.lastName}`.trim(),
            }
          : null,
        verified: approvalInfo?.verified
          ? {
            userId: approvalInfo.verified.userId,
            name: approvalInfo.verified.userName,
            status: approvalInfo.verified.status,
            reason: approvalInfo.verified?.reason || null,
          }
          : null,
        firstApproved: approvalInfo?.firstApproved
          ? {
            userId: approvalInfo.firstApproved.userId,
            name: approvalInfo.firstApproved.userName,
            status: approvalInfo.firstApproved.status,
            reason: approvalInfo.firstApproved?.reason || null,
          }
          : null,
        secondApproved: approvalInfo?.secondApproved
          ? {
            userId: approvalInfo.secondApproved.userId,
            name: approvalInfo.secondApproved.userName,
            status: approvalInfo.secondApproved.status,
            reason: approvalInfo.secondApproved?.reason || null,
          }
          : null,
        thirdApproved: approvalInfo?.thirdApproved
          ? {
            userId: approvalInfo.thirdApproved.userId,
            name: approvalInfo.thirdApproved.userName,
            status: approvalInfo.thirdApproved.status,
            reason: approvalInfo.thirdApproved?.reason || null,
          }
          : null,
        firstFinalized: approvalInfo?.firstFinalized
          ? {
            userId: approvalInfo.firstFinalized.userId,
            name: approvalInfo.firstFinalized.userName,
            status: approvalInfo.firstFinalized.status,
            reason: approvalInfo.firstFinalized?.reason || null,
          }
          : null,
        secondFinalized: approvalInfo?.secondFinalized
          ? {
            userId: approvalInfo.secondFinalized.userId,
            name: approvalInfo.secondFinalized.userName,
            status: approvalInfo.secondFinalized.status,
            reason: approvalInfo.secondFinalized?.reason || null,
          }
          : null,
      };
      const result = {
        documentId: document.id,
        documentTypeId: document.document_type_id,
        status: document.status,
        overAllStatus: document.status,
        createdBy: document.lastActionBy
          ? `${document.lastActionBy.firstName} ${document.lastActionBy.lastName}`
          : null,
        approvalSummary: approvalInfoSummary,
      };
      await this.cacheService.set(cacheKey, result, 30); // 30s TTL — status changes
      return result;
    } catch (error) {
      throw new Error(`Error fetching document: ${error}`);
    }
  }

  async getDocumentByTypeId(documentTypeId: string): Promise<any> {
    try {
      const document = await this.documentbRepository.findOne({
        where: { document_type_id: documentTypeId },
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
        ],
      });

      return document;
    } catch (error) {
      throw new Error(`Error fetching document by type ID: ${error}`);
    }
  }

  async startApprovalFlow(documentId: string): Promise<void> {
   // console.log("Starting approval flow for document ID:", documentId);
    const document = await this.documentbRepository.findOne({
      where: { id: documentId },
      relations: [
        'approvalFlow',
        'approvalFlow.verifiers',
        'approvalFlow.approvers',
        'approvalFlow.approvers.firstApprover.users',
        'approvalFlow.approvers.secondApprover.users',
        'approvalFlow.approvers.thirdApprover.users',
        'approvalFlow.approvers.fourthApprover.users',
        'approvalFlow.approvers.fifthApprover.users',
        'approvalFlow.approvers.sixthApprover.users',
      ],
    });
  
//console.log("Document for starting approval flow: ", document?.type);
    if (!document) {
      throw new Error('Document not found');
    }

    if (!document.approvalFlow) {
      //console.log('No approval flow configured for document:', documentId);
      return;
    }

    const { approvalFlow, totalAmt, type } = document;

    if (
      [
        DocumentTypeEnum.GRN,
        DocumentTypeEnum.LABOR_PAYMENT_VOUCHER,
        DocumentTypeEnum.MULTI_CASH_VOUCHER,
        DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER,
        DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER
      ].includes(type) &&
      approvalFlow.verifiers.length > 0
    ) {
      await this.assignToUsers(documentId, approvalFlow.verifiers, 'verifier');
      return;
    }

    const approvers = this.getMatchingApproverBlock(
      totalAmt,
      approvalFlow.approvers,
    );
    if (!approvers) {
      throw new Error('No approver found for this document amount.');
    } else if (this.isSingleApprovalBasedDocument(type) /*&& approvers*/) {
      const FirstLevelApprovers =
        document.approvalFlow.approvers.firstApprover.users;
      //console.log('FirstLevelApprovers', FirstLevelApprovers);
      await this.assignToUsers(documentId, FirstLevelApprovers, 'approver');
      return;
    } else if (this.isDoubleApprovalBasedDocument(type) /*&& approvers*/) {
      const firstLevelApprovers =
        document.approvalFlow.approvers.firstApprover.users;
      const secondLevelApprovers =
        document.approvalFlow.approvers.secondApprover.users;
    
      await this.assignToUsers(documentId, firstLevelApprovers, 'approver');
      await this.assignToUsers(documentId, secondLevelApprovers, 'approver');
      return;
    }
    await this.assignToUsers(documentId, approvers, 'approver');
  }

  getMatchingApproverBlock(
    amount: number,
    level: ApprovalLevel,
  ): User[] | null {
    const blocks: (ApproverBlock | null)[] = [
      level.firstApprover,
      level.secondApprover,
      level.thirdApprover,
    ];

    for (const block of blocks) {
      if (
        block &&
        amount >= (block.minAmtCanApprove || 0) &&
        amount <= (block.maxAmtCanApprove || Infinity)
      ) {
        return block.users;
      }
    }
    return null;
  }

  async approveDocumentStep(
    documentId: string,
    userId: string,
    action: ApproverStatus,
    reason?: string,
  ): Promise<void> {
    const document = await this.documentbRepository.findOne({
      where: { id: documentId },
      relations: [
        'lastActionBy',
        'approvalFlow',
        
        'approvalFlow.verifiers',
        'approvalFlow.approvers.firstApprover.users',
        'approvalFlow.approvers.secondApprover.users',
        'approvalFlow.approvers.thirdApprover.users',
        'approvalFlow.finalizers.firstFinalizers',
        'approvalFlow.finalizers.secondFinalizers',
        'approvalInfo',
        
        'approvalInfo.verified',
        'approvalInfo.firstApproved',
        'approvalInfo.secondApproved',
        'approvalInfo.thirdApproved',
        'approvalInfo.firstFinalized',
        'approvalInfo.secondFinalized',
      ],
    });

    if (!document || !document.approvalFlow) {
      throw new Error('Document or its approval flow not found');
    }

    const now = new Date();
    const userName = await this.getCachedUser(userId);
    const docNo = await this.resolveDocumentTypeNo(document);
    const readableType = getReadableDocumentType(document.type);
    const docLabel = docNo ? `${readableType} #${docNo}` : readableType;

    const bustDocCache = () => {
      const typeId = document.document_type_id;
      const prefixMap: Partial<Record<DocumentTypeEnum, string[]>> = {
        [DocumentTypeEnum.RFPA]: [
          'rfpa:list:*', 'rfpa:all:*', 'rfpa:recycle:*', 'rfpa:rfpanumbers:*',
          ...(typeId ? [`rfpa:id:${typeId}`, `rfpa:view:${typeId}`, `rfpa:update:${typeId}`] : []),
          `rfpa:docview:${documentId}`,
        ],
        [DocumentTypeEnum.DEAL_SLIP]: [
          'dealslip:list:*', 'dealslip:all:*', 'dealslip:recycle:*', 'dealslip:nos:*',
          ...(typeId ? [`dealslip:id:${typeId}`, `dealslip:view:${typeId}`, `dealslip:update:${typeId}`] : []),
          `dealslip:docview:${documentId}`,
        ],
        [DocumentTypeEnum.GRN]: [
          'grn:all:*', 'grn:recycle:*', 'grn:numbers:*',
          ...(typeId ? [`grn:id:${typeId}`, `grn:details:${typeId}`] : []),
          `grn:view:${documentId}`, `grn:update:${documentId}`,
        ],
        [DocumentTypeEnum.AQR]: [
          'aqr:list:*', 'aqr:all:*', 'aqr:recycle:*',
          ...(typeId ? [`aqr:id:${typeId}`, `aqr:update:${typeId}`] : []),
          `aqr:view:${documentId}`,
        ],
        [DocumentTypeEnum.INWARD_REGISTER]: [
          'iwr:list:*', 'iwr:all:*', 'iwr:recycle:*',
          ...(typeId ? [`iwr:id:${typeId}`, `iwr:update:${typeId}`] : []),
          `iwr:view:${documentId}:*`,
        ],
        [DocumentTypeEnum.DUMP_REGISTER]: [
          'dump:list:*', 'dump:all:*', 'dump:recycle:*',
          ...(typeId ? [`dump:id:${typeId}`, `dump:update:${typeId}`] : []),
          `dump:view:${documentId}`,
        ],
        [DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER]: [
          'vehicleDispatch:list:*', 'vehicleDispatch:all:*', 'vehicleDispatch:recycle:*',
          ...(typeId ? [`vehicleDispatch:id:${typeId}`, `vehicleDispatch:update:${typeId}`] : []),
          `vehicleDispatch:view:${documentId}:*`,
        ],
        [DocumentTypeEnum.SECOND_SALE]: [
          'secondSale:list:*', 'secondSale:all:*', 'secondSale:recycle:*',
          ...(typeId ? [`secondSale:id:${typeId}`, `secondSale:update:${typeId}`] : []),
          `secondSale:view:${documentId}`,
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
        [DocumentTypeEnum.RETURN_BY_CUSTOMER]: [
          'rbc:list:*', 'rbc:all:*', 'rbc:recycle:*',
          ...(typeId ? [`rbc:id:${typeId}`, `rbc:update:${typeId}`] : []),
          `rbc:view:${documentId}`, `rbc:update:${documentId}`, `rbc:id:${documentId}`,
        ],
        [DocumentTypeEnum.RETURN_TO_VENDOR]: [
          'returnToVendor:list:*', 'returnToVendor:all:*', 'returnToVendor:recycle:*',
          ...(typeId ? [`returnToVendor:id:${typeId}`, `returnToVendor:update:${typeId}`] : []),
          `returnToVendor:view:${documentId}`,
        ],
        [DocumentTypeEnum.FINAL_INVOICE]: [
          'finv:list:*', 'finv:all:*', 'finv:recycle:*',
          ...(typeId ? [`finv:id:${typeId}`, `finv:update:${typeId}`] : []),
          `finv:view:${documentId}`,
        ],
        [DocumentTypeEnum.EOD_REPORT]: [],
        [DocumentTypeEnum.PROFORMA_INVOICE]: [],
      };

      const keys = prefixMap[document.type as DocumentTypeEnum] ?? [];
      const tasks: Promise<any>[] = [this.cacheService.del(`doc:byid:${documentId}`)];
      for (const key of keys) {
        if (key.endsWith(':*')) {
          tasks.push(this.cacheService.invalidatePattern(key));
        } else {
          tasks.push(this.cacheService.del(key));
        }
      }
      return Promise.all(tasks);
    };

    try {

    
    if (!document.approvalInfo) {
      document.approvalInfo = await this.documentApprovalFlowRepository.save(
        this.documentApprovalFlowRepository.create()
      );
      await this.documentbRepository.save(document);
    }

    const info = document.approvalInfo;
    const flow = document.approvalFlow;

    if (document.type === DocumentTypeEnum.GRN || document.type === DocumentTypeEnum.MULTI_CASH_VOUCHER
      || document.type === DocumentTypeEnum.LABOR_PAYMENT_VOUCHER || document.type === DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER ||
      document.type === DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER) {

      if (!info.verified) {
        const isVerifier = flow.verifiers.some(u => u.id === userId);
        if (isVerifier) {
          const verifierStage = await this.approvalStageInfoRepository.save({
            userId,
            userName,
            status: action,
            reason: reason ?? '',
            statusChangedAt: now,
          });

          info.verified = verifierStage;
          await this.documentApprovalFlowRepository.save(info);

          if (action === ApproverStatus.REJECTED) {
            document.status = DocumentStatus.REJECT;
            document.remarks = `${document.type} Rejected by Verifier`;
            await this.documentbRepository.save(document);
            await this.notificationService.createNoti(`You rejected ${docLabel} at Verifier stage`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was rejected at Verifier stage by ${userName}`);
            await this.notifyStageParticipants(flow.verifiers, userId, `${docLabel} was rejected at Verifier stage by ${userName}. No action needed from you`);
            return;
          }

          document.status = DocumentStatus.VERIFIED;
          document.remarks = `${document.type} Verified by Verifier`;
          await this.documentbRepository.save(document);

          await this.notificationService.createNoti(`You verified ${docLabel} at Verifier stage`, userId);
          await this.notifyCreator(document, `Your ${docLabel} was verified by ${userName}. Now at Approver Level 1`);
          await this.notifyStageParticipants(flow.verifiers, userId, `${docLabel} has already been verified by ${userName}. No action needed from you`);

          await this.assignToUsers(documentId, flow.approvers.firstApprover.users, 'approver');
          await this.assignToUsers(documentId, flow.approvers.secondApprover.users, 'approver');
          await this.assignToUsers(documentId, flow.approvers.thirdApprover.users, 'approver');
          return;
        } else {
          throw new Error('Only verifiers can act at this stage');
        }
      }

      const totalAmt = Number(document.totalAmt) || 0;
      const firstBlock = flow.approvers.firstApprover;
      const secondBlock = flow.approvers.secondApprover;
      const thirdBlock = flow.approvers.thirdApprover;

     
      
      

function isWithinRange(min: number | string | null, max: number | string | null, value: number | string): boolean {
  const minVal = min !== null ? Number(min) : 0;
  const maxVal = max !== null ? Number(max) : Infinity;
  const val = typeof value === 'string' ? Number(value) : value;
  return val >= minVal && val <= maxVal;
}

      const requiresFirst = firstBlock?.users?.length > 0 &&
        isWithinRange(firstBlock.minAmtCanApprove, firstBlock.maxAmtCanApprove, document.totalAmt);

      const requiresSecond = secondBlock?.users?.length > 0 &&
        isWithinRange(secondBlock.minAmtCanApprove, secondBlock.maxAmtCanApprove, document.totalAmt);

      const requiresThird = thirdBlock?.users?.length > 0 &&
        isWithinRange(thirdBlock.minAmtCanApprove, thirdBlock.maxAmtCanApprove, document.totalAmt);

      // console.log('first:', requiresFirst);
      // console.log('second:', requiresSecond);
      // console.log('third:', requiresThird);

      if (requiresFirst && !info.firstApproved && firstBlock.users.some(u => u.id === userId)) {
        //console.log('in first block amount:', totalAmt);

        if (!info.firstApproved) {
          const stage = await this.approvalStageInfoRepository.save({
            userId,
            userName,
            status: action,
            reason: reason ?? '',
            statusChangedAt: now,
          });

          info.firstApproved = stage;
          await this.documentApprovalFlowRepository.save(info);

          if (action === ApproverStatus.REJECTED) {
            document.status = DocumentStatus.REJECT;
            document.remarks = `${document.type} Rejected at Approver Level 1`;
            await this.documentbRepository.save(document);
            await this.notificationService.createNoti(`You rejected ${docLabel} at Approver Level 1`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was rejected at Approver Level 1 by ${userName}`);
            await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} was rejected at Approver Level 1 by ${userName}. No action needed from you`);
            return;
          }

          const a1 = info.firstApproved?.status === ApproverStatus.APPROVED;
          const a2 = info.secondApproved?.status === ApproverStatus.APPROVED;
          const a3 = info.thirdApproved?.status === ApproverStatus.APPROVED;

          if (a1) {
            //console.log("Shri in service");
            document.status = DocumentStatus.APPROVED;
            document.remarks = `${document.type} Approved by Required Approvers`;
            await this.documentbRepository.save(document);
            await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 1 by ${userName}. Now at Finalizer Level 1`);
            await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} has already been approved at Approver Level 1 by ${userName}. No action needed from you`);
            await this.assignToUsers(documentId, flow.finalizers.firstFinalizers, 'finalizer');
            return;
          }

          await this.notificationService.createNoti(`You approved ${docLabel} at Approver Level 1`, userId);
          await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 1 by ${userName}. Waiting for remaining approvers`);
          await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} has already been approved at Approver Level 1 by ${userName}. No action needed from you`);
          return;

        } else {
          throw new Error('First approver has already acted on this document');
        }

      }

      if (requiresSecond && (!info.firstApproved || !info.secondApproved) && (firstBlock.users.some(u => u.id === userId) || secondBlock.users.some(u => u.id === userId))) {
        //console.log("helloo");

        if (firstBlock.users.some(u => u.id === userId)) {
          if (!info.firstApproved) {
            const stage = await this.approvalStageInfoRepository.save({
              userId,
              userName,
              status: action,
              reason: reason ?? '',
              statusChangedAt: now,
            });
            info.firstApproved = stage;

            await this.documentApprovalFlowRepository.save(info);

            if (action === ApproverStatus.REJECTED) {
              document.status = DocumentStatus.REJECT;
              document.remarks = `${document.type} Rejected at Approver Level 2`;
              await this.documentbRepository.save(document);
              await this.notificationService.createNoti(`You rejected ${docLabel} at Approver Level 1`, userId);
              await this.notifyCreator(document, `Your ${docLabel} was rejected at Approver Level 1 by ${userName}`);
              await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} was rejected at Approver Level 1 by ${userName}. No action needed from you`);
              return;
            }

            const a1 = info.firstApproved?.status === ApproverStatus.APPROVED;
            const a2 = info.secondApproved?.status === ApproverStatus.APPROVED;
            const a3 = info.thirdApproved?.status === ApproverStatus.APPROVED;

            if (a1 && a2) {
              document.status = DocumentStatus.APPROVED;
              document.remarks = `${document.type} Approved by Required Approvers`;
              await this.documentbRepository.save(document);
              await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 1 by ${userName}. Now at Finalizer Level 1`);
              await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} has already been approved at Approver Level 1 by ${userName}. No action needed from you`);
              if (secondBlock.users && secondBlock.users.length > 0) {
                await this.notificationService.createBatchNoti(
                  `${docLabel} has been fully approved. Now moving to Finalizer Level 1`,
                  secondBlock.users.map(u => u.id)
                );
              }
              await this.assignToUsers(documentId, flow.finalizers.firstFinalizers, 'finalizer');
              return;
            }

            await this.notificationService.createNoti(`You approved ${docLabel} at Approver Level 1`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 1 by ${userName}. Now waiting for Approver Level 2`);
            await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} has already been approved at Approver Level 1 by ${userName}. No action needed from you`);
            if (secondBlock.users && secondBlock.users.length > 0) {
              await this.notificationService.createBatchNoti(
                `${docLabel} has been approved at Approver Level 1 by ${userName}. Your approval is now required at Approver Level 2`,
                secondBlock.users.map(u => u.id)
              );
            }
            return;

          }
          else {
            throw new Error('First approver has already acted on this document');
          }
        } else if (secondBlock.users.some(u => u.id === userId)) {
          if (!info.secondApproved) {
            const stage = await this.approvalStageInfoRepository.save({
              userId,
              userName,
              status: action,
              reason: reason ?? '',
              statusChangedAt: now,
            });
            info.secondApproved = stage;

            await this.documentApprovalFlowRepository.save(info);

            if (action === ApproverStatus.REJECTED) {
              document.status = DocumentStatus.REJECT;
              document.remarks = `${document.type} Rejected at Approver Level 2`;
              await this.documentbRepository.save(document);
              await this.notificationService.createNoti(`You rejected ${docLabel} at Approver Level 2`, userId);
              await this.notifyCreator(document, `Your ${docLabel} was rejected at Approver Level 2 by ${userName}`);
              await this.notifyStageParticipants(secondBlock.users, userId, `${docLabel} was rejected at Approver Level 2 by ${userName}. No action needed from you`);
              return;
            }

            const a1 = info.firstApproved?.status === ApproverStatus.APPROVED;
            const a2 = info.secondApproved?.status === ApproverStatus.APPROVED;

            if (
              (a1 && a2)
            ) {
              //console.log("Hey i am in second block amount, ", totalAmt);

              document.status = DocumentStatus.APPROVED;
              document.remarks = `${document.type} Approved by Required Approvers`;
              await this.documentbRepository.save(document);
              await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 2 by ${userName}. Now at Finalizer Level 1`);
              await this.notifyStageParticipants(secondBlock.users, userId, `${docLabel} has already been approved at Approver Level 2 by ${userName}. No action needed from you`);
              if (firstBlock.users && firstBlock.users.length > 0) {
                await this.notificationService.createBatchNoti(
                  `${docLabel} has been fully approved by ${userName}. Now moving to Finalizer Level 1`,
                  firstBlock.users.map(u => u.id)
                );
              }
              await this.assignToUsers(documentId, flow.finalizers.firstFinalizers, 'finalizer');
              return;
            }

            await this.notificationService.createNoti(`You approved ${docLabel} at Approver Level 2`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 2 by ${userName}. Waiting for remaining approvers`);
            await this.notifyStageParticipants(secondBlock.users, userId, `${docLabel} has already been approved at Approver Level 2 by ${userName}. No action needed from you`);
            return;

          } else {
            throw new Error('Second approver has already acted on this document');
          }
        } else {
          throw new Error('User is not authorized to act on this document at this stage');
        }
      }

      if (requiresThird && (!info.firstApproved || !info.secondApproved || !info.thirdApproved) && (firstBlock.users.some(u => u.id === userId) || secondBlock.users.some(u => u.id === userId) || thirdBlock.users.some(u => u.id === userId))) {

        if (firstBlock.users.some(u => u.id === userId)) {
          if (!info.firstApproved) {
            const stage = await this.approvalStageInfoRepository.save({
              userId,
              userName,
              status: action,
              reason: reason ?? '',
              statusChangedAt: now,
            });
            info.firstApproved = stage;
            await this.documentApprovalFlowRepository.save(info);
            if (action === ApproverStatus.REJECTED) {
              document.status = DocumentStatus.REJECT;
              document.remarks = `${document.type} Rejected at Approver Level 3`;
              await this.documentbRepository.save(document);
              await this.notificationService.createNoti(`You rejected ${docLabel} at Approver Level 1`, userId);
              await this.notifyCreator(document, `Your ${docLabel} was rejected at Approver Level 1 by ${userName}`);
              await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} was rejected at Approver Level 1 by ${userName}. No action needed from you`);
              return;
            }

            const a1 = info.firstApproved?.status === ApproverStatus.APPROVED;
            const a2 = info.secondApproved?.status === ApproverStatus.APPROVED;
            const a3 = info.thirdApproved?.status === ApproverStatus.APPROVED;

            if (a1 && a2 && a3) {
              document.status = DocumentStatus.APPROVED;
              document.remarks = `${document.type} Approved by All Approvers`;
              await this.documentbRepository.save(document);
              await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 1 by ${userName}. Now at Finalizer Level 1`);
              await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} has already been approved at Approver Level 1 by ${userName}. No action needed from you`);
              const l2l3UserIds = [
                ...(secondBlock.users?.map(u => u.id) ?? []),
                ...(thirdBlock.users?.map(u => u.id) ?? []),
              ];
              if (l2l3UserIds.length > 0) {
                await this.notificationService.createBatchNoti(
                  `${docLabel} has been fully approved. Now moving to Finalizer Level 1`,
                  l2l3UserIds
                );
              }
              await this.assignToUsers(documentId, flow.finalizers.firstFinalizers, 'finalizer');
              return;
            }
            await this.notificationService.createNoti(`You approved ${docLabel} at Approver Level 1`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 1 by ${userName}. Now waiting for Approver Level 2`);
            await this.notifyStageParticipants(firstBlock.users, userId, `${docLabel} has already been approved at Approver Level 1 by ${userName}. No action needed from you`);
            if (secondBlock.users && secondBlock.users.length > 0) {
              await this.notificationService.createBatchNoti(
                `${docLabel} has been approved at Approver Level 1 by ${userName}. Your approval is now required at Approver Level 2`,
                secondBlock.users.map(u => u.id)
              );
            }
            return;
          } else {
            throw new Error('First approver has already acted on this document');
          }
        } else if (secondBlock.users.some(u => u.id === userId)) {
          if (!info.secondApproved) {
            const stage = await this.approvalStageInfoRepository.save({
              userId,
              userName,
              status: action,
              reason: reason ?? '',
              statusChangedAt: now,
            });
            info.secondApproved = stage;
            await this.documentApprovalFlowRepository.save(info);
            if (action === ApproverStatus.REJECTED) {
              document.status = DocumentStatus.REJECT;
              document.remarks = `${document.type} Rejected at Approver Level 3`;
              await this.documentbRepository.save(document);
              await this.notificationService.createNoti(`You rejected ${docLabel} at Approver Level 2`, userId);
              await this.notifyCreator(document, `Your ${docLabel} was rejected at Approver Level 2 by ${userName}`);
              await this.notifyStageParticipants(secondBlock.users, userId, `${docLabel} was rejected at Approver Level 2 by ${userName}. No action needed from you`);
              return;
            }
            const a1 = info.firstApproved?.status === ApproverStatus.APPROVED;
            const a2 = info.secondApproved?.status === ApproverStatus.APPROVED;
            const a3 = info.thirdApproved?.status === ApproverStatus.APPROVED;
            if (a1 && a2 && a3) {
              document.status = DocumentStatus.APPROVED;
              document.remarks = `${document.type} Approved by All Approvers`;
              await this.documentbRepository.save(document);
              await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 2 by ${userName}. Now at Finalizer Level 1`);
              await this.notifyStageParticipants(secondBlock.users, userId, `${docLabel} has already been approved at Approver Level 2 by ${userName}. No action needed from you`);
              const l1l3UserIds = [
                ...(firstBlock.users?.map(u => u.id) ?? []),
                ...(thirdBlock.users?.map(u => u.id) ?? []),
              ];
              if (l1l3UserIds.length > 0) {
                await this.notificationService.createBatchNoti(
                  `${docLabel} has been fully approved. Now moving to Finalizer Level 1`,
                  l1l3UserIds
                );
              }
              await this.assignToUsers(documentId, flow.finalizers.firstFinalizers, 'finalizer');
              return;
            }
            await this.notificationService.createNoti(`You approved ${docLabel} at Approver Level 2`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 2 by ${userName}. Now waiting for Approver Level 3`);
            await this.notifyStageParticipants(secondBlock.users, userId, `${docLabel} has already been approved at Approver Level 2 by ${userName}. No action needed from you`);
            if (thirdBlock.users && thirdBlock.users.length > 0) {
              await this.notificationService.createBatchNoti(
                `${docLabel} has been approved at Approver Level 2 by ${userName}. Your approval is now required at Approver Level 3`,
                thirdBlock.users.map(u => u.id)
              );
            }
            return;
          } else {
            throw new Error('Second approver has already acted on this document');
          }
        } else if (thirdBlock.users.some(u => u.id === userId)) {
          if (!info.thirdApproved) {
            const stage = await this.approvalStageInfoRepository.save({
              userId,
              userName,
              status: action,
              reason: reason ?? '',
              statusChangedAt: now,
            });
            info.thirdApproved = stage;
            await this.documentApprovalFlowRepository.save(info);
            if (action === ApproverStatus.REJECTED) {
              document.status = DocumentStatus.REJECT;
              document.remarks = `${document.type} Rejected at Approver Level 3`;
              await this.documentbRepository.save(document);
              await this.notificationService.createNoti(`You rejected ${docLabel} at Approver Level 3`, userId);
              await this.notifyCreator(document, `Your ${docLabel} was rejected at Approver Level 3 by ${userName}`);
              await this.notifyStageParticipants(thirdBlock.users, userId, `${docLabel} was rejected at Approver Level 3 by ${userName}. No action needed from you`);
              return;
            }
            const a1 = info.firstApproved?.status === ApproverStatus.APPROVED;
            const a2 = info.secondApproved?.status === ApproverStatus.APPROVED;
            const a3 = info.thirdApproved?.status === ApproverStatus.APPROVED;
            if (a1 && a2 && a3) {
              document.status = DocumentStatus.APPROVED;
              document.remarks = `${document.type} Approved by All Approvers`;
              await this.documentbRepository.save(document);
              await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 3 by ${userName}. Now at Finalizer Level 1`);
              await this.notifyStageParticipants(thirdBlock.users, userId, `${docLabel} has already been approved at Approver Level 3 by ${userName}. No action needed from you`);
              const l1l2UserIds = [
                ...(firstBlock.users?.map(u => u.id) ?? []),
                ...(secondBlock.users?.map(u => u.id) ?? []),
              ];
              if (l1l2UserIds.length > 0) {
                await this.notificationService.createBatchNoti(
                  `${docLabel} has been fully approved. Now moving to Finalizer Level 1`,
                  l1l2UserIds
                );
              }
              await this.assignToUsers(documentId, flow.finalizers.firstFinalizers, 'finalizer');
              return;
            }
            await this.notificationService.createNoti(`You approved ${docLabel} at Approver Level 3`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was approved at Approver Level 3 by ${userName}. Waiting for remaining approvers`);
            await this.notifyStageParticipants(thirdBlock.users, userId, `${docLabel} has already been approved at Approver Level 3 by ${userName}. No action needed from you`);
            return;
          } else {
            throw new Error('Third approver has already acted on this document');
          }
        } else {
          throw new Error('User is not authorized to act on this document at this stage');
        }

      }

      if (!info.firstFinalized) {
        const isFinalizer1 = flow.finalizers.firstFinalizers.some(u => u.id === userId);
        if (isFinalizer1) {
          const a1 = info.firstApproved?.status === ApproverStatus.APPROVED;
          const a2 = info.secondApproved?.status === ApproverStatus.APPROVED;
          const a3 = info.thirdApproved?.status === ApproverStatus.APPROVED;

          const requiredApprovalsPassed =
            (!requiresFirst || a1) &&
            (!requiresSecond || (a1 && a2)) &&
            (!requiresThird || (a1 && a2 && a3));
          //console.log('status: ', document.status);

          if (document.status !== DocumentStatus.APPROVED || !requiredApprovalsPassed) {
            throw new Error('Required approver levels have not approved yet for Finalizer 1 to act.');
          }
          //console.log("REqui: ", requiredApprovalsPassed);

          const stage = await this.approvalStageInfoRepository.save({
            userId,
            userName,
            status: action,
            reason: reason ?? '',
            statusChangedAt: now,
          });

          info.firstFinalized = stage;
          await this.documentApprovalFlowRepository.save(info);

          if (action === ApproverStatus.REJECTED) {
            document.status = DocumentStatus.REJECT;
            document.remarks = `${document.type} Rejected by First Finalizer`;
            await this.notificationService.createNoti(`You rejected ${docLabel} at Finalizer Level 1`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was rejected at Finalizer Level 1 by ${userName}`);
            await this.notifyStageParticipants(flow.finalizers.firstFinalizers, userId, `${docLabel} was rejected at Finalizer Level 1 by ${userName}. No action needed from you`);
          } else {
            document.status = DocumentStatus.FINALIZING;
            document.remarks = `${document.type} Approved by First Finalizer`;
            await this.notificationService.createNoti(`You approved ${docLabel} at Finalizer Level 1`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was approved at Finalizer Level 1 by ${userName}. Now at Finalizer Level 2`);
            await this.notifyStageParticipants(flow.finalizers.firstFinalizers, userId, `${docLabel} has already been approved at Finalizer Level 1 by ${userName}. No action needed from you`);
            await this.assignToUsers(documentId, flow.finalizers.secondFinalizers, 'finalizer');
          }

          await this.documentbRepository.save(document);
          return;
        }
      }

      if (!info.secondFinalized) {
        const isFinalizer2 = flow.finalizers.secondFinalizers.some(u => u.id === userId);
        if (isFinalizer2) {
          if (!info.firstFinalized || info.firstFinalized.status !== ApproverStatus.APPROVED) {
            throw new Error('Finalizer 1 must approve before Finalizer 2 can act');
          }

          const stage = await this.approvalStageInfoRepository.save({
            userId,
            userName,
            status: action,
            reason: reason ?? '',
            statusChangedAt: now,
          });

          info.secondFinalized = stage;
          await this.documentApprovalFlowRepository.save(info);

          if (action === ApproverStatus.REJECTED) {
            document.status = DocumentStatus.REJECT;
            document.remarks = `${document.type} Rejected by Second Finalizer`;
            await this.documentbRepository.save(document);
            await this.notificationService.createNoti(`You rejected ${docLabel} at Finalizer Level 2`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was rejected at Finalizer Level 2 by ${userName}`);
            await this.notifyStageParticipants(flow.finalizers.secondFinalizers, userId, `${docLabel} was rejected at Finalizer Level 2 by ${userName}. No action needed from you`);
            
            const backwardChainUserIds = [
              ...(flow.finalizers.firstFinalizers?.map(u => u.id) ?? []),
              ...(flow.approvers.firstApprover?.users?.map(u => u.id) ?? []),
              ...(flow.approvers.secondApprover?.users?.map(u => u.id) ?? []),
              ...(flow.approvers.thirdApprover?.users?.map(u => u.id) ?? []),
              ...(flow.verifiers?.map(u => u.id) ?? []),
            ];
            if (backwardChainUserIds.length > 0) {
              await this.notificationService.createBatchNoti(
                `${docLabel} was rejected at Finalizer Level 2 by ${userName}`,
                backwardChainUserIds
              );
            }
          } else {
            document.status = DocumentStatus.COMPLETE;
            document.remarks = `${document.type} Fully Approved and Finalized`;
            await this.documentbRepository.save(document);
            await this.notificationService.createNoti(`You approved ${docLabel} at Finalizer Level 2`, userId);
            await this.notifyCreator(document, `Your ${docLabel} was approved at Finalizer Level 2 by ${userName}. Document is now Complete`);
            await this.notifyStageParticipants(flow.finalizers.secondFinalizers, userId, `${docLabel} has already been finalized at Finalizer Level 2 by ${userName}. No action needed from you`);
            
            const backwardChainUserIds = [
              ...(flow.finalizers.firstFinalizers?.map(u => u.id) ?? []),
              ...(flow.approvers.firstApprover?.users?.map(u => u.id) ?? []),
              ...(flow.approvers.secondApprover?.users?.map(u => u.id) ?? []),
              ...(flow.approvers.thirdApprover?.users?.map(u => u.id) ?? []),
              ...(flow.verifiers?.map(u => u.id) ?? []),
            ];
            if (backwardChainUserIds.length > 0) {
              await this.notificationService.createBatchNoti(
                `${docLabel} has been fully finalized by ${userName}. Document is now Complete`,
                backwardChainUserIds
              );
            }
            return;
          }

          await this.documentbRepository.save(document);
          return;
        }
      }

    }

    throw new Error('User is not authorized to act on this document at this stage');
    } finally {
      await bustDocCache();
    }
  }

  

  private async notifyCreator(document: any, message: string): Promise<void> {
    const creatorId = document?.approvalFlow?.creator?.id;
    if (!creatorId) return;
    try {
      await this.notificationService.createNoti(message, creatorId);
    } catch (err) {
      logger.error(`Failed to notify creator ${creatorId}:`, err);
    }
  }

  /**
   * Notify all users at a stage EXCEPT the actor.
   * Used to inform same-stage peers that someone has already acted.
   */
  private async notifyStageParticipants(
    stageUsers: User[],
    actorUserId: string,
    message: string,
  ): Promise<void> {
    const otherUserIds = stageUsers
      .filter((u) => u.id !== actorUserId)
      .map((u) => u.id);
    
    if (otherUserIds.length > 0) {
      try {
        await this.notificationService.createBatchNoti(message, otherUserIds);
      } catch (err) {
        logger.error(`Failed to notify stage participants:`, err);
      }
    }
  }

  public async resolveDocumentTypeNo(document: any): Promise<string | null> {
    if (!document?.document_type_id) return null;
    try {
      switch (document.type) {
        case DocumentTypeEnum.GRN: {
          const doc = await this.grnRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.grnNo ?? null;
        }
        case DocumentTypeEnum.RFPA: {
          const doc = await this.rfpaRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.rfpaId ?? null;
        }
        case DocumentTypeEnum.DEAL_SLIP: {
          const doc = await this.dealSlipRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.dealSlipNo ?? null;
        }
        case DocumentTypeEnum.LABOR_PAYMENT_VOUCHER: {
          const doc = await this.lpVoucherRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.voucherNo ?? null;
        }
        case DocumentTypeEnum.AQR: {
          const doc = await this.aqrRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.aqrNo ?? null;
        }
        case DocumentTypeEnum.SECOND_SALE: {
          const doc = await this.secondSaleRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.secondSaleNo ?? null;
        }
        case DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER: {
          const doc = await this.vehicleDispatchRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.vehicleDispatchNo ?? null;
        }
        case DocumentTypeEnum.DUMP_REGISTER: {
          const doc = await this.dumpRegisterRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.dumpNo ?? null;
        }
        case DocumentTypeEnum.INWARD_REGISTER: {
          const doc = await this.inwardRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.inwardNo ?? null;
        }
        case DocumentTypeEnum.DC_TYPE_OTHER: {
          const doc = await this.otherDCRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.challanNo ?? null;
        }
        case DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER: {
          const doc = await this.stockTransferDCRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.challanNo ?? null;
        }
        case DocumentTypeEnum.DC_TYPE_CUSTOMER: {
          const doc = await this.customerDCRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.challanNo ?? null;
        }
        case DocumentTypeEnum.RETURN_BY_CUSTOMER: {
          const doc = await this.rbcRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.rbcNo ?? null;
        }
        case DocumentTypeEnum.RETURN_TO_VENDOR: {
          const doc = await this.rtvRepository.findOne({ where: { id: document.document_type_id } });
          return doc?.rtvNo ?? null;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  async assignToUsers(
    documentId: string,
    users: User[],
    role: 'verifier' | 'approver' | 'finalizer',
  ): Promise<void> {
    if (!users || users.length === 0) {
      logger.warn(`No users provided to assign for document ${documentId} as ${role}`);
      return;
    }

    logger.log(`Assigning document ${documentId} to ${role}s:`, users.map((u) => u.id));

    const document = await this.documentbRepository.findOne({ where: { id: documentId } });

    const documentTypeNo = await this.resolveDocumentTypeNo(document);
    const richMessage = documentTypeNo
      ? `You have been assigned as a ${role} for ${document?.type} #${documentTypeNo}`
      : `You have been assigned as a ${role} for ${document?.type} document`;

    users.forEach((user) => {
      this.notificationService.createNoti(richMessage, user.id).catch((err) =>
        logger.error(`Failed to send notification to user ${user.id}:`, err)
      );
    });
  }



  public async getAllDocumentByUserId(userId: string, documentType: string, queryOptions: PaginationOptions, skipPagination: boolean = false, includeDeleted: boolean = false): Promise<any> {

    if (!Object.values(DocumentTypeEnum).includes(documentType as DocumentTypeEnum)) {
      throw new Error(`Invalid document type: ${documentType}`);
    }

    const queryBuilder = this.documentbRepository
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.approvalFlow', 'approvalFlow')
      .leftJoinAndSelect('approvalFlow.verifiers', 'verifier')
      .leftJoinAndSelect('approvalFlow.approvers', 'approvalLevel')
      .leftJoinAndSelect('approvalLevel.firstApprover', 'firstApproverBlock')
      .leftJoinAndSelect('firstApproverBlock.users', 'firstApproverUser')
      .leftJoinAndSelect('approvalLevel.secondApprover', 'secondApproverBlock')
      .leftJoinAndSelect('secondApproverBlock.users', 'secondApproverUser')
      .leftJoinAndSelect('approvalLevel.thirdApprover', 'thirdApproverBlock')
      .leftJoinAndSelect('thirdApproverBlock.users', 'thirdApproverUser')
      .leftJoinAndSelect('approvalLevel.fourthApprover', 'fourthApproverBlock')
      .leftJoinAndSelect('fourthApproverBlock.users', 'fourthApproverUser')
      .leftJoinAndSelect('approvalLevel.fifthApprover', 'fifthApproverBlock')
      .leftJoinAndSelect('fifthApproverBlock.users', 'fifthApproverUser')
      .leftJoinAndSelect('approvalLevel.sixthApprover', 'sixthApproverBlock')
      .leftJoinAndSelect('sixthApproverBlock.users', 'sixthApproverUser')
      .leftJoinAndSelect('approvalFlow.finalizers', 'finalizerBlock')
      .leftJoinAndSelect('finalizerBlock.firstFinalizers', 'firstFinalizerUser')
      .leftJoinAndSelect('finalizerBlock.secondFinalizers', 'secondFinalizerUser')
      .leftJoinAndSelect('document.lastActionBy', 'lastActionBy')
      .leftJoinAndSelect('document.approvalInfo', 'approvalInfo')
      .leftJoinAndSelect('approvalInfo.firstFinalized', 'firstFinalized')
      .leftJoinAndSelect('approvalInfo.secondFinalized', 'secondFinalized')
      .where(
        new Brackets((qb) => {
          // Creator — नेहमी दिसतो (सर्व statuses)
          qb.where('lastActionBy.id = :userId', { userId })

          // Verifier — HOLD (act करायचं आहे) + VERIFIED/APPROVED/COMPLETE/REJECT (act केलं आहे)
          .orWhere(
            new Brackets((vb) => {
              vb.where('verifier.id = :userId', { userId })
                .andWhere(`document.status IN (:...verifierStatuses)`, {
                  verifierStatuses: [
                    DocumentStatus.HOLD,
                    DocumentStatus.VERIFIED,
                    DocumentStatus.APPROVED,
                    DocumentStatus.FINALIZING,
                    DocumentStatus.COMPLETE,
                    DocumentStatus.REJECT,
                  ],
                });
            }),
          )

          // Approvers (L1/L2/L3/L4/L5/L6) — VERIFIED (act करायचं आहे) + APPROVED/COMPLETE/REJECT (act केलं आहे)
          .orWhere(
            new Brackets((ab) => {
              ab.where(
                new Brackets((inner) => {
                  inner
                    .where('firstApproverUser.id = :userId', { userId })
                    .orWhere('secondApproverUser.id = :userId', { userId })
                    .orWhere('thirdApproverUser.id = :userId', { userId })
                    .orWhere('fourthApproverUser.id = :userId', { userId })
                    .orWhere('fifthApproverUser.id = :userId', { userId })
                    .orWhere('sixthApproverUser.id = :userId', { userId });
                }),
              ).andWhere(`document.status IN (:...approverStatuses)`, {
                approverStatuses: [
                  DocumentStatus.VERIFIED,
                  DocumentStatus.APPROVED,
                  DocumentStatus.FINALIZING,
                  DocumentStatus.COMPLETE,
                  DocumentStatus.REJECT,
                ],
              });
            }),
          )

          // First Finalizers — APPROVED (act करायचं आहे) + COMPLETE/REJECT (act केलं आहे) + FINALIZING जर firstFinalized नाही
          .orWhere(
            new Brackets((fb) => {
              fb.where('firstFinalizerUser.id = :userId', { userId })
                .andWhere(
                  new Brackets((inner) => {
                    // APPROVED status - first finalizer needs to act
                    inner.where('document.status = :approvedStatusF1', { approvedStatusF1: DocumentStatus.APPROVED })
                    // FINALIZING status but firstFinalized is null - first finalizer needs to act
                    .orWhere(
                      new Brackets((sub) => {
                        sub.where('document.status = :finalizingStatusF1', { finalizingStatusF1: DocumentStatus.FINALIZING })
                           .andWhere('firstFinalized.id IS NULL');
                      })
                    )
                    // COMPLETE/REJECT - first finalizer has acted
                    .orWhere('document.status IN (:...completedStatusesF1)', {
                      completedStatusesF1: [DocumentStatus.COMPLETE, DocumentStatus.REJECT]
                    });
                  })
                );
            }),
          )

          // Second Finalizers — FINALIZING जर firstFinalized आहे (act करायचं आहे) + COMPLETE/REJECT (act केलं आहे)
          .orWhere(
            new Brackets((fb) => {
              fb.where('secondFinalizerUser.id = :userId', { userId })
                .andWhere(
                  new Brackets((inner) => {
                    // FINALIZING status and firstFinalized exists - second finalizer needs to act
                    inner.where(
                      new Brackets((sub) => {
                        sub.where('document.status = :finalizingStatusF2', { finalizingStatusF2: DocumentStatus.FINALIZING })
                           .andWhere('firstFinalized.id IS NOT NULL');
                      })
                    )
                    // COMPLETE/REJECT - second finalizer has acted
                    .orWhere('document.status IN (:...completedStatusesF2)', {
                      completedStatusesF2: [DocumentStatus.COMPLETE, DocumentStatus.REJECT]
                    });
                  })
                );
            }),
          );
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

    const [data, total] = await queryBuilder.getManyAndCount();

    let paginatedData = data;
    let currentPage = 1;
    let currentLimit = total; // Default to all records if no pagination
    
    if (!skipPagination && queryOptions?.page && queryOptions?.limit) {
      const page = queryOptions.page;
      const limit = queryOptions.limit;
      const skip = (page - 1) * limit;

      paginatedData = data.slice(skip, skip + limit);
      currentPage = page;
      currentLimit = limit;
    }

    return {
      data: paginatedData,
      meta: {
        total,
        page: currentPage,
        pages: currentLimit ? Math.ceil(total / currentLimit) : 1,
      },
    };
  }

}



  // async getAllHoldGrnDocuments(): Promise<any[]> {
  //   return this.documentbRepository.find({
  //     where: {
  //       type: DocumentTypeEnum.GRN,
  //       status: DocumentStatus.HOLD,
  //     },
  //     relations: [
  //       'lastActionBy',
  //       'approvalFlow',
  //       'approvalFlow.verifiers',
  //       'approvalFlow.approvers',
  //       'approvalFlow.approvers.firstApprover.users',
  //       'approvalFlow.approvers.secondApprover.users',
  //       'approvalFlow.approvers.thirdApprover.users',
  //       'approvalFlow.approvers.fourthApprover.users',
  //       'approvalFlow.approvers.fifthApprover.users',
  //       'approvalFlow.approvers.sixthApprover.users',
  //       'approvalFlow.finalizers',
  //       'approvalFlow.finalizers.firstFinalizers',
  //       'approvalFlow.finalizers.secondFinalizers',
  //     ],
  //     order: { createdAt: 'DESC' }, // optional: newest first
  //   });
  // }