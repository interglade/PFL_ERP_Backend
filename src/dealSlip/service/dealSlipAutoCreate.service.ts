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
import { RFPA_COPY_RELATIONS, copyRfpaPaymentInfo, copyRfpaProducts, dealSlipHeaderFromRfpa } from "./dealSlipRfpaCopy";

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

    let savedDealSlip: DealSlip;

    try {
      const rfpa = await queryRunner.manager.findOne(this.rfpaRepository.target, {
        where: { id: rfpaId },
        relations: RFPA_COPY_RELATIONS,
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

      const paymentInfo = await copyRfpaPaymentInfo(queryRunner.manager, rfpa);

      const dealSlip = queryRunner.manager.create(this.dealSlipRepository.target, {
        ...dealSlipHeaderFromRfpa(rfpa),
        rfpa,
        paymentInfo,
        dealSlipNo: await this.generateDealSlipNo(),
        // Left empty on purpose (lotNo, loadingLocation and specialRequest are NOT NULL columns,
        // so '' is stored); the RFPA creator fills lot no / loading location in from the edit screen.
        lotNo: '',
        loadingLocation: '',
        specialRequest: '',
        remark: '',
        createdBy: { id: requestedBy },
      } as any) as unknown as DealSlip;

      savedDealSlip = await queryRunner.manager.save(dealSlip);
      await copyRfpaProducts(queryRunner.manager, savedDealSlip, rfpa);

      // Not rfpa.save(): the RFPA is loaded with its products and parties, and saving it would
      // cascade over all of them.
      await queryRunner.manager.update(this.rfpaRepository.target, { id: rfpaId }, { isDealSlipCreated: true });

      // DRAFT: the document is not sent to approvers (no startApprovalFlow) until lot no and
      // loading location are filled in; DealSlipService.updateDealSlip then moves it to HOLD.
      await this.documentbService.createDocument({
        type: DocumentTypeEnum.DEAL_SLIP,
        docDef: DocDefEnum.PROCUREMENT,
        status: DocumentStatus.DRAFT,
        remarks: 'Deal Slip auto-created as draft; waiting for lot no and loading location',
        lastActionBy: { id: requestedBy },
        document_type_id: savedDealSlip.id,
      });

      await queryRunner.commitTransaction();
    } catch (error) {
      if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

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
  private async generateDealSlipNo(): Promise<string> {
    const prefix = `DL${this.datePrefix()}`;
    const result = await this.dealSlipRepository
      .createQueryBuilder('ds')
      .select('MAX(ds.dealSlipNo)', 'maxId')
      .where('ds.dealSlipNo LIKE :prefix', { prefix: `${prefix}%` })
      .getRawOne();

    const parsed = result?.maxId ? parseInt(result.maxId.replace(prefix, ''), 10) : NaN;
    const nextSeq = isNaN(parsed) ? 1 : parsed + 1;
    return `${prefix}${nextSeq.toString().padStart(5, '0')}`;
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
