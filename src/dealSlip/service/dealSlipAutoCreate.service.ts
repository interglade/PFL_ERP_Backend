import { compactDate, nextDocumentNumber, SERIES } from '../../global/numbering/documentNumber';
import { inject, injectable } from "inversify";
import { DataSource } from "typeorm";
import { TYPES } from "../../types";
import AppError from "../../utils/appError";
import logger from "../../utils/logger";
import { DealSlipRepository } from "../repository/dealSlip.repository";
import { RfpaRepository } from "../../rfpa/repository/rfpa.repository";
import { DealSlip } from "../entity/dealSlip.entity";
import { CacheService } from "../../global/cache.service";
import { DocumentbRepository } from "../../approvalFlow/repository/documentb.repository";
import { DocumentbService } from "../../approvalFlow/service/documentb.service";
import { ApprovalFlowService } from "../../approvalFlow/service/approvalFlow.service";
import { DocumentStatus, DocumentTypeEnum } from "../../approvalFlow/entity/docuemnt.entity";
import { DocumentTypeEnum as DocDefEnum } from "../../documentDef/entity/documentdef.entity";

/**
 * Creates a Deal Slip automatically once an RFPA document reaches COMPLETE.
 * Kept separate from DealSlipService because DealSlipService depends on the approver
 * services that trigger this, and injecting it back would be a circular dependency.
 */
@injectable()
export class DealSlipAutoCreateService {
  constructor(
    @inject(TYPES.DealSlipRepository)
    private readonly dealSlipRepository: DealSlipRepository,
    @inject(TYPES.RfpaRepository)
    private readonly rfpaRepository: RfpaRepository,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService,
    @inject(TYPES.ApprovalFlowService)
    private readonly approvalFlowService: ApprovalFlowService,
    @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Never throws: the RFPA approval has already been saved as COMPLETE, so a failure here
   * must not fail that approval. Errors are logged instead.
   */
  async createForCompletedRfpa(rfpaId: string): Promise<DealSlip | null> {
    try {
      return await this.create(rfpaId);
    } catch (error: any) {
      logger.error(`Auto deal slip creation failed for RFPA ${rfpaId}: ${error?.message ?? error}`);
      return null;
    }
  }

  private async create(rfpaId: string): Promise<DealSlip | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let documentId: string;
    let savedDealSlip: DealSlip;

    try {
      const rfpa = await queryRunner.manager.findOne(this.rfpaRepository.target, {
        where: { id: rfpaId },
        relations: ['createdBy'],
      }) as any;

      if (!rfpa) throw new AppError(404, 'RFPA not found');
      if (rfpa.isDealSlipCreated) {
        await queryRunner.rollbackTransaction();
        return null;
      }

      // RFPA.createdBy is not populated on create; the creator is stored on the RFPA's document.
      let requestedBy: string | undefined = rfpa.createdBy?.id;
      if (!requestedBy) {
        const rfpaDocument = await this.documentbRepository.findOne({
          where: { type: DocumentTypeEnum.RFPA, document_type_id: rfpaId },
          relations: ['lastActionBy'],
        });
        requestedBy = rfpaDocument?.lastActionBy?.id;
      }
      if (!requestedBy) throw new AppError(400, 'RFPA has no creator to start the Deal Slip approval flow');

      const approvalFlow = await this.approvalFlowService.getApprovalFlowForUserAndDepartment(requestedBy, DocDefEnum.PROCUREMENT);
      if (!approvalFlow) {
        throw new AppError(400, `Approval flow not configured for the RFPA creator for ${DocDefEnum.PROCUREMENT} documents`);
      }

      const dealSlip = queryRunner.manager.create(this.dealSlipRepository.target, {
        rfpa,
        dealSlipNo: await this.generateDealSlipNo(),
        // Left empty on purpose (lotNo, loadingLocation and specialRequest are NOT NULL columns,
        // so '' is stored); the user fills them in later from the edit screen.
        lotNo: '',
        loadingLocation: '',
        specialRequest: '',
        remark: '',
        requestingDepartment: rfpa.requestingDepartment,
        createdBy: { id: requestedBy },
      } as any) as unknown as DealSlip;

      savedDealSlip = await queryRunner.manager.save(dealSlip);

      rfpa.isDealSlipCreated = true;
      await queryRunner.manager.save(rfpa);

      const document = await this.documentbService.createDocument({
        type: DocumentTypeEnum.DEAL_SLIP,
        docDef: DocDefEnum.PROCUREMENT,
        status: DocumentStatus.HOLD,
        remarks: 'Document auto-created with Deal Slip',
        lastActionBy: { id: requestedBy },
        document_type_id: savedDealSlip.id,
      });
      documentId = document.id;

      await queryRunner.commitTransaction();
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    await this.documentbService.startApprovalFlow(documentId);
    await this.invalidateCache();
    return savedDealSlip;
  }

  private datePrefix(): string {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  // Same scheme as DealSlipService.generateDealSlipId (DLyyyymmddNNNNN).
  /** Next number of the day; issued by the shared sequence (no COUNT / MAX race, never reused). */
  private async generateDealSlipNo(): Promise<string> {
    return nextDocumentNumber(this.dealSlipRepository.manager, SERIES.dealSlip, `DL${this.datePrefix()}`, 5);
  }

  private async invalidateCache(): Promise<void> {
    await Promise.all([
      this.cacheService.invalidatePattern('dealslip:list:*'),
      this.cacheService.invalidatePattern('dealslip:recycle:*'),
      this.cacheService.invalidatePattern('dealslip:all:*'),
      this.cacheService.invalidatePattern('dealslip:nos:*'),
      this.cacheService.invalidatePattern('dealslip:filter:*'),
      this.cacheService.invalidatePattern('rfpa:list:*'),
      this.cacheService.invalidatePattern('rfpa:all:*'),
      this.cacheService.invalidatePattern('rfpa:rfpanumbers:*'),
    ]);
  }
}
