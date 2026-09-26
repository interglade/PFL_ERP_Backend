import {
  controller,
  httpGet,
  httpPost,
  next,
  requestParam,
  response,
  request,
  requestBody,
  httpPatch,
} from 'inversify-express-utils';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { inject } from 'inversify';
import { TYPES } from '../../types';

import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';
import AppError from '../../utils/appError';

import { Brackets } from 'typeorm';

import { Documentb, DocumentStatus, DocumentTypeEnum } from '../entity/docuemnt.entity';
import { buildQuery, PaginationOptions } from '../../utils/pagination';
import { ApprovalFlowRepository } from '../repository/approvalFlow.repository';

import { ApproverStatus } from '../entity/approvalname.entity';
import { DocumentbService } from '../service/documentb.service';
import { DocumentbRepository } from '../repository/documentb.repository';
import { DocDoubleApproverService } from '../service/docDoubleApprover.service';
import { DocSingalApproverService } from '../service/DocSingalApproverService.service';
import { GrnRepository } from '../../grn/repository/grn.repository';


interface DocumentWithRelatedData extends Documentb {
  relatedData?: any;
}

@controller('/documents', deserializeUser, requireUser)
export class DocumentbController {
  constructor(
    @inject(TYPES.DocumentbService)
    private docuemntbService: DocumentbService,
    @inject(TYPES.DocumentbRepository)
    private documentbRepository: DocumentbRepository,
    @inject(TYPES.GrnRepository) private readonly grnRepository: GrnRepository,
    @inject(TYPES.ApprovalFlowRepository)
    private approvalFlowRepo: ApprovalFlowRepository,
    @inject(TYPES.DocDoubleApproverService)
    private docDoubleApproveService: DocDoubleApproverService,
    @inject(TYPES.DocSingalApproverService)
    private docSingleApproveService: DocSingalApproverService
  ) { }


  


  @httpPatch('/update/:documentId')
  async approveDocument(req: Request, res: Response): Promise<void> {
    
    try {
      const userId = res.locals.user.id; // Auth middleware should attach the user
      
      const { documentId } = req.params;
      const { status, reason } = req.body;
      

      // ✅ Validate status
      if (!['approved', 'reject','query'].includes(status)) {
        res.status(400).json({ message: 'Invalid status. Must be approved or reject.' });
        return;
      }

      await this.docuemntbService.approveDocumentStep(
        documentId,
        userId,
        status as ApproverStatus,
        reason,
      );

      res.status(200).json({ message: `Document ${status} successfully` });
    } catch (error: any) {
      console.error('Error approving document:', error.message);
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  }

  //TODO: Update double level approver document
  @httpPatch('/updatesecondlevel/:documentId')
  async approveDocumentForDoubleLevel(req: Request, res: Response): Promise<void> {
    
    try {
      const userId = res.locals.user.id; // Auth middleware should attach the user
      
      const { documentId } = req.params;
      const { status, reason } = req.body;
      

      // ✅ Validate status
      if (!['approved', 'reject','query'].includes(status)) {
        res.status(400).json({ message: 'Invalid status. Must be approved or reject.' });
        return;
      }

      await this.docDoubleApproveService.approveDocumentStepForDoubleLevel(
        documentId,
        userId,
        status as ApproverStatus,
        reason,
      );

      res.status(200).json({ message: `Document ${status} successfully` });
    } catch (error: any) {
      console.error('Error approving document:', error.message);
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  }

  @httpPatch('/updatefirstlevel/:documentId')
  async approveDocumentStepForSingleAndDoubleLevel(req: Request, res: Response): Promise<void> {
    try {
      const userId = res.locals.user.id; // Auth middleware should attach the user
      
      const { documentId } = req.params;
      const { status, reason } = req.body;

      // ✅ Validate status
      if (!['approved', 'reject','query'].includes(status)) {
        res.status(400).json({ message: 'Invalid status. Must be approved or reject.' });
        return;
      }

      await this.docSingleApproveService.approveDocumentStepForSingleLevel(
        documentId,
        userId,
        status as ApproverStatus,
        reason,
      );

      res.status(200).json({ message: `Document ${status} successfully` });
    } catch (error: any) {
      console.error('Error approving document:', error.message);
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  }


}


// //   Get Alll
//   @httpGet('/userid/:documentType')
// public async getDocumentByUserId(
//   @requestParam('documentType') documentType: string,
//   @request() req: Request,
//   @response() res: Response,
//   @next() next: NextFunction,
// ) {
//   try {
//     const userId = res.locals.user.id;

//     // 🔒 Validate documentType
    
//     if (!Object.values(DocumentTypeEnum).includes(documentType as DocumentTypeEnum)) {
//       return res.status(400).json({
//         status: 'error',
//         message: `Invalid document type: ${documentType}`,
//       });
//     }

//     const paginationOptions: PaginationOptions = {
//       page: Number(req.query.page) || 1,
//       limit: Number(req.query.limit) || 10,
//       search: req.query.search as string,
//       sort: req.query.sort as string,
//       filters: req.query.filters
//         ? JSON.parse(req.query.filters as string)
//         : {},
//       //searchFields: ['type', 'remarks'],
//     };

//     const queryBuilder = this.documentbRepository
//       .createQueryBuilder('document')
//       .leftJoinAndSelect('document.approvalFlow', 'approvalFlow')
//       .leftJoinAndSelect('approvalFlow.verifiers', 'verifier')
//       .leftJoinAndSelect('approvalFlow.approvers', 'approvalLevel')
//       .leftJoinAndSelect('approvalLevel.firstApprover', 'firstApproverBlock')
//       .leftJoinAndSelect('firstApproverBlock.users', 'firstApproverUser')
//       .leftJoinAndSelect('approvalLevel.secondApprover', 'secondApproverBlock')
//       .leftJoinAndSelect('secondApproverBlock.users', 'secondApproverUser')
//       .leftJoinAndSelect('approvalLevel.thirdApprover', 'thirdApproverBlock')
//       .leftJoinAndSelect('thirdApproverBlock.users', 'thirdApproverUser')
//       .leftJoinAndSelect('approvalLevel.fourthApprover', 'fourthApproverBlock')
//       .leftJoinAndSelect('fourthApproverBlock.users', 'fourthApproverUser')
//       .leftJoinAndSelect('approvalLevel.fifthApprover', 'fifthApproverBlock')
//       .leftJoinAndSelect('fifthApproverBlock.users', 'fifthApproverUser')
//       .leftJoinAndSelect('approvalLevel.sixthApprover', 'sixthApproverBlock')
//       .leftJoinAndSelect('sixthApproverBlock.users', 'sixthApproverUser')
//       .leftJoinAndSelect('approvalFlow.finalizers', 'finalizerBlock')
//       .leftJoinAndSelect('finalizerBlock.firstFinalizers', 'firstFinalizerUser')
//       .leftJoinAndSelect('finalizerBlock.secondFinalizers', 'secondFinalizerUser')
//       .leftJoinAndSelect('document.lastActionBy', 'lastActionBy')
//       .where(
//         new Brackets((qb) => {
//           qb.where('verifier.id = :userId', { userId })
//             .orWhere('firstApproverUser.id = :userId', { userId })
//             .orWhere('secondApproverUser.id = :userId', { userId })
//             .orWhere('thirdApproverUser.id = :userId', { userId })
//             .orWhere('fourthApproverUser.id = :userId', { userId })
//             .orWhere('fifthApproverUser.id = :userId', { userId })
//             .orWhere('sixthApproverUser.id = :userId', { userId })
//             .orWhere('firstFinalizerUser.id = :userId', { userId })
//             .orWhere('secondFinalizerUser.id = :userId', { userId })
//             .orWhere('lastActionBy.id = :userId', { userId });
//         }),
//       )
//       .andWhere('document.document_type_id IS NOT NULL')
//       .andWhere('document.type = :documentType', { documentType });

//     // Apply search/filter/sort/pagination
//     const { data: documents, meta } = await buildQuery(
//       queryBuilder,
//       paginationOptions,
//       'document',
//     );

    

//     const typedDocuments = documents as DocumentWithRelatedData[];

//     for (const doc of typedDocuments) {
//       if (!doc.document_type_id) continue;

//       try {
//         if (doc.type === DocumentTypeEnum.GRN) {
//           doc.relatedData = await this.grnRepository.findOne({
//             where: { id: doc.document_type_id },
//             relations: ['paymentInfo'],
//           });
//         } else if (doc.type === DocumentTypeEnum.RFPA) {
//           // Add RFPA fetch logic when needed
//         }
//       } catch {
//         doc.relatedData = null;
//       }
//     }

//     const relatedDataOnly = typedDocuments
//       .filter((d) => d)
//       .map((doc) => ({
//         documentId: doc.id,

//         documentType: doc.type,
//         status: doc.status,
//         ...doc.relatedData,
//       }));

//     res.status(200).json({
//       status: 'success',
//       count: relatedDataOnly.length,
//       meta,
//       data: relatedDataOnly,
//     });
//   } catch (err) {
//     logger.error('Error fetching documents by user and type', { error: err });
//     next(err);
//   }
// }


//   @httpGet('/:id')
//   public async getbyIdDocument(
//     @requestParam('id') id: string,
//     @response() res: Response,
//     @next() next: NextFunction,
//   ) {
//     try {
//       logger.info('Fetching all documents');
//       const departments = await this.docuemntbService.getDocumentById(id);
//       if (!departments) {
//         logger.warn('No documents found');
//         return next(new AppError(404, 'No documents found'));
//       }
//       logger.info('Documents retrieved successfully');
//       res.status(200).json({
//         status: 'success',
//         data: departments,
//       });
//     } catch (err) {
//       logger.error('Error occurred while fetching all documents', {
//         error: err,
//       });
//       next(err);
//     }
//   }

//   //TODO: Start approval method
//   @httpPost('/:id/start-approval')
//   public async startApprovalFlow(
//     @requestParam('id') id: string,
//     @response() res: Response,
//     @next() next: NextFunction,
//   ) {
//     try {
//       logger.info('Starting approval flow for document', { id });
//       await this.docuemntbService.startApprovalFlow(id);
//       logger.info('Approval flow started successfully');

//       res.status(200).json({
//         status: 'success',
//         message: 'Approval flow started.',
//       });
//     } catch (err) {
//       logger.error('Error starting approval flow', { error: err });
//       next(err);
//     }
//   }


  //TODO:Get Document by user id by Shri
  // @httpGet('/userid/')
  // public async getDocumentByUserId(
  //   @requestParam('id') id: string,
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction,
  // ) {
  //   try {
  //     const userId = res.locals.user.id;

  //     // Extract pagination from query params
  //     const paginationOptions: PaginationOptions = {
  //       page: Number(req.query.page) || 1,
  //       limit: Number(req.query.limit) || 10,
  //       search: req.query.search as string,
  //       sort: req.query.sort as string,
  //       filters: req.query.filters
  //         ? JSON.parse(req.query.filters as string)
  //         : {},
  //       searchFields: ['type', 'remarks'], // adjust fields as needed
  //     };

  //     // Build initial query
  //     const queryBuilder = this.documentbRepository
  //       .createQueryBuilder('document')
  //       .leftJoinAndSelect('document.approvalFlow', 'approvalFlow')
  //       .leftJoinAndSelect('approvalFlow.verifiers', 'verifier')
  //       .leftJoinAndSelect('approvalFlow.approvers', 'approvalLevel')
  //       .leftJoinAndSelect('approvalLevel.firstApprover', 'firstApproverBlock')
  //       .leftJoinAndSelect('firstApproverBlock.users', 'firstApproverUser')
  //       .leftJoinAndSelect(
  //         'approvalLevel.secondApprover',
  //         'secondApproverBlock',
  //       )
  //       .leftJoinAndSelect('secondApproverBlock.users', 'secondApproverUser')
  //       .leftJoinAndSelect('approvalLevel.thirdApprover', 'thirdApproverBlock')
  //       .leftJoinAndSelect('thirdApproverBlock.users', 'thirdApproverUser')
  //       .leftJoinAndSelect(
  //         'approvalLevel.fourthApprover',
  //         'fourthApproverBlock',
  //       )
  //       .leftJoinAndSelect('fourthApproverBlock.users', 'fourthApproverUser')
  //       .leftJoinAndSelect('approvalLevel.fifthApprover', 'fifthApproverBlock')
  //       .leftJoinAndSelect('fifthApproverBlock.users', 'fifthApproverUser')
  //       .leftJoinAndSelect('approvalLevel.sixthApprover', 'sixthApproverBlock')
  //       .leftJoinAndSelect('sixthApproverBlock.users', 'sixthApproverUser')
  //       .leftJoinAndSelect('approvalFlow.finalizers', 'finalizerBlock')
  //       .leftJoinAndSelect(
  //         'finalizerBlock.firstFinalizers',
  //         'firstFinalizerUser',
  //       )
  //       .leftJoinAndSelect(
  //         'finalizerBlock.secondFinalizers',
  //         'secondFinalizerUser',
  //       ).leftJoinAndSelect(
  //         'document.lastActionBy', 'lastActionBy')
  //       .where(
  //         new Brackets((qb) => {
  //           qb.where('verifier.id = :userId', { userId })
  //             .orWhere('firstApproverUser.id = :userId', { userId })
  //             .orWhere('secondApproverUser.id = :userId', { userId })
  //             .orWhere('thirdApproverUser.id = :userId', { userId })
  //             .orWhere('fourthApproverUser.id = :userId', { userId })
  //             .orWhere('fifthApproverUser.id = :userId', { userId })
  //             .orWhere('sixthApproverUser.id = :userId', { userId })
  //             .orWhere('firstFinalizerUser.id = :userId', { userId })
  //             .orWhere('secondFinalizerUser.id = :userId', { userId })
  //             .orWhere('lastActionBy.id = :userId', { userId });
  //         }),
  //       )
  //       .andWhere('document.document_type_id IS NOT NULL');

  //     // Apply search/filter/sort/pagination
  //     const { data: documents, meta } = await buildQuery(
  //       queryBuilder,
  //       paginationOptions,
  //       'document',
  //     );
  //     const typedDocuments = documents as DocumentWithRelatedData[];

  //     for (const doc of typedDocuments) {
  //       if (!doc.document_type_id) continue;

  //       try {
  //         if (doc.type === DocumentTypeEnum.GRN) {
  //           doc.relatedData = await this.grnRepository.findOne({
  //             where: { id: doc.document_type_id },
  //             relations: ['paymentInfo']
  //           });
  //         } else if (doc.type === DocumentTypeEnum.RFPA) {
  //           // doc.relatedData = await this.rfpaRepository.findOne({ where: { id: doc.document_type_id } });
  //         }
  //       } catch {
  //         doc.relatedData = null;
  //       }
  //     }

  //     const relatedDataOnly = typedDocuments
  //       .filter((d) => d)
  //       .map((doc) => ({
  //        documentId: doc.id,
  //        documentType: doc.type,
  //        status: doc.status,
  //        ...doc.relatedData,
  //       }));

  //     res.status(200).json({
  //       status: 'success',
  //       count: relatedDataOnly.length,
  //       meta,
  //       data: relatedDataOnly,
  //     });
  //   } catch (err) {
  //     logger.error('Error fetching paginated documents with related data', {
  //       error: err,
  //     });
  //     next(err);
  //   }
  // }


