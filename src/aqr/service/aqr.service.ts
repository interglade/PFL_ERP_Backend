import { inject, injectable } from "inversify";
import { TYPES } from "../../types";
import { CreatedWithApproval, withApproval } from "../../utils/approvalMessage";

import AppError from "../../utils/appError";
import { PaginationOptions } from "../../utils/pagination";
import { formatDateTime } from "../../utils/dateUtils";
import logger from "../../utils/logger";

import { DocumentStatus, DocumentTypeEnum } from "../../approvalFlow/entity/docuemnt.entity";
import { DocumentTypeEnum as DocDefEnum } from "../../documentDef/entity/documentdef.entity";

import { DataSource, DeepPartial, EntityManager } from "typeorm";

import { CacheService } from "../../global/cache.service";
import {
  AqrListItemDto,
  AqrParameterResponseDto,
  AqrProductLineResponseDto,
  BulkDeleteAqrResultDto,
  CreateAqrDto,
  CustomerPartyDto,
  DeleteAqrResultDto,
  FarmerPartyDto,
  GetAqrByIdForViewResponseDto,
  GetAqrForUpdateResponseDto,
  UpdateAqrDto,
  VendorPartyDto,
} from "../dto/aqr.dto";
import { Source } from "../../utils/status.enum";
import { AqrRepository } from "../repository/aqr.repository";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { DocSingalApproverService } from "../../approvalFlow/service/DocSingalApproverService.service";
import { DocumentbService, DocumentWithRelatedData } from "../../approvalFlow/service/documentb.service";
import { DocumentbRepository } from "../../approvalFlow/repository/documentb.repository";
import { ApprovalFlowService } from "../../approvalFlow/service/approvalFlow.service";
import { Aqr } from "../entity/aqr.entity";
import { AqrProduct } from "../entity/aqrProduct.entity";
import { AqrParameter, QualityParameterType } from "../entity/aqrQuality.entity";
import { ReceivingGuardService } from "../../receiving/service/receivingGuard.service";
import { ReceivingSourceType, ResolvedSource } from "../../receiving/receiving.types";
import { productKey } from "../../receiving/receiving.helpers";
import {
  AqrLineInput,
  AqrSourceRef,
  defaultPercentage,
  parseQuantity,
  refIdOf,
  validateAqrRequest,
} from "./aqr.validation";


const CACHE_PREFIX = "aqr";
const CACHE_TTL = 120; // 2 minutes for list data
const CACHE_TTL_DETAIL = 300; // 5 minutes for detail views

/** Source references of an AQR as the list / view / update-view return them. */
interface AqrSourceInfo {
  sourceType: ReceivingSourceType | null;
  sourceNo: string | null;
  grnNo: { id: string; grnNo: string | null } | null;
  deliveryChallanNo: { id: string; challanNo: string | null } | null;
  rbcNo: { id: string; rbcNo: string | null } | null;
}

/** Decimal / varchar quantity → number, null when empty or not numeric. */
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const fixed2 = (value: number | null): string | null => (value === null ? null : value.toFixed(2));

const sum = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

@injectable()
export class AqrService {
  constructor(
    @inject(TYPES.AqrRepository)
    private readonly aqrRepo: AqrRepository,
    @inject(TYPES.AuditLogService)
    private readonly auditLogService: AuditLogService,
    @inject(TYPES.DocSingalApproverService)
    private readonly docSingalApproverService: DocSingalApproverService,
    @inject(TYPES.DocumentbService)
    private readonly documentbService: DocumentbService,
    @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.ApprovalFlowService)
    private approvalFlowService: ApprovalFlowService,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
    @inject(TYPES.ReceivingGuardService)
    private readonly receivingGuardService: ReceivingGuardService,
  ) { }

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  private cacheKey(...parts: string[]): string {
    return this.cacheService.generateKey(CACHE_PREFIX, ...parts);
  }

  private async invalidateAqrCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:filter:*`),
      // View keys are suffixed with the viewing user; drop them all.
      this.cacheService.invalidatePattern(`${CACHE_PREFIX}:view:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(this.cacheKey("id", id)),
        this.cacheService.del(this.cacheKey("update", id)),
        this.cacheService.del(this.cacheKey("view", id)),
      );
    }
    await Promise.all(tasks);
  }

  // ─── Serial Number ────────────────────────────────────────────────────────

  private async generateSerialNo(): Promise<string> {
    const now = new Date();
    const datePrefix = `AQR${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

    const result = await this.aqrRepo
      .createQueryBuilder("aqr")
      .select("MAX(aqr.aqrNo)", "maxNo")
      .where("aqr.aqrNo LIKE :prefix", { prefix: `${datePrefix}%` })
      .getRawOne();

    let nextSeq = 1;
    if (result?.maxNo) {
      const lastSeq = parseInt(result.maxNo.replace(datePrefix, ""), 10);
      if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
    }
    return `${datePrefix}${nextSeq.toString().padStart(5, "0")}`;
  }

  // ─── Shared mapping helpers ───────────────────────────────────────────────

  /** Source type / number and the three references, from the loaded relations. */
  private sourceInfo(aqr: Aqr): AqrSourceInfo {
    const declared = aqr.aqrFor ? ReceivingGuardService.sourceTypeFromDocKind(aqr.aqrFor) : null;
    const picked = ReceivingGuardService.pickSourceRef(
      { grnId: aqr.grn?.id, deliveryChallanId: aqr.deliveryChallanNo?.id, rbcId: aqr.rbc?.id },
      declared,
    );
    const sourceType = picked?.sourceType ?? declared ?? null;
    let sourceNo: string | null = null;
    if (picked?.sourceType === "grn") sourceNo = aqr.grn?.grnNo ?? null;
    else if (picked?.sourceType === "stock-transfer-dc") sourceNo = aqr.deliveryChallanNo?.challanNo ?? null;
    else if (picked?.sourceType === "rbc") sourceNo = aqr.rbc?.rbcNo ?? null;

    return {
      sourceType,
      sourceNo,
      grnNo: aqr.grn ? { id: aqr.grn.id, grnNo: aqr.grn.grnNo ?? null } : null,
      deliveryChallanNo: aqr.deliveryChallanNo ? { id: aqr.deliveryChallanNo.id, challanNo: aqr.deliveryChallanNo.challanNo ?? null } : null,
      rbcNo: aqr.rbc ? { id: aqr.rbc.id, rbcNo: aqr.rbc.rbcNo ?? null } : null,
    };
  }

  private mapParameter(param: AqrParameter): AqrParameterResponseDto {
    return {
      id: param.id,
      qualityParameterId: param.qualityParameterId,
      qualityParameterName: param.qualityParameterName,
      qualityParameterType: param.qualityParameterType,
      quantity: num(param.quantity),
      percentage: num(param.percentage),
    };
  }

  private mapLine(line: AqrProduct): AqrProductLineResponseDto {
    return {
      id: line.id,
      product: line.productName
        ? {
          id: line.productName.id,
          name: line.productName.name ?? null,
          productCode: line.productName.productCode ?? null,
          packingType: line.productName.packingType ?? null,
        }
        : null,
      variant: line.variant ? { id: line.variant.id, variantName: line.variant.variantName ?? null } : null,
      uom: line.uom ? { id: line.uom.id, name: line.uom.unit ?? null, unit: line.uom.unit ?? null } : null,
      receivedQty: num(line.receivedQty),
      arrivedQty: num(line.arrivedQty),
      samplingQty: num(line.samplingQty),
      totalQty: num(line.totalQty),
      totalpercent: num(line.totalpercent),
      remark: line.remark ?? null,
      parameters: (line.parameters ?? [])
        .slice()
        .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
        .map((p) => this.mapParameter(p)),
    };
  }

  /** A legacy AQR keeps its single product in the header; present it as one line. */
  private legacyLine(aqr: Aqr): AqrProductLineResponseDto | null {
    if (!aqr.product) return null;
    return {
      id: null,
      product: {
        id: aqr.product.id,
        name: aqr.product.name ?? null,
        productCode: aqr.product.productCode ?? null,
        packingType: aqr.product.packingType ?? null,
      },
      variant: aqr.variant ? { id: aqr.variant.id, variantName: aqr.variant.variantName ?? null } : null,
      uom: null,
      receivedQty: null,
      arrivedQty: num(aqr.arrivedQty),
      samplingQty: num(aqr.samplingQty),
      totalQty: num(aqr.totalQty),
      totalpercent: num(aqr.totalpercent),
      remark: null,
      parameters: (aqr.parameters ?? []).map((p) => this.mapParameter(p)),
    };
  }

  /** The AQR's lines in creation order, or one synthesised line for a legacy AQR. */
  private linesOf(aqr: Aqr): AqrProductLineResponseDto[] {
    const lines = (aqr.products ?? [])
      .slice()
      .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
      .map((l) => this.mapLine(l));
    if (lines.length > 0) return lines;
    const legacy = this.legacyLine(aqr);
    return legacy ? [legacy] : [];
  }

  // ─── Request → entity helpers ─────────────────────────────────────────────

  /**
   * The lines of a request. Old clients that still send the single-product
   * header fields get one line built from them so they go through the same
   * validation and guard.
   */
  private linesFromRequest(data: CreateAqrDto | UpdateAqrDto): AqrLineInput[] | undefined {
    if (Array.isArray(data.products) && data.products.length > 0) return data.products;
    if (Array.isArray(data.products)) return data.products; // explicit empty list → validation error
    if (data.product && refIdOf(data.product)) {
      return [{
        product: data.product,
        variant: data.variant ?? null,
        arrivedQty: data.arrivedQty ?? null,
        samplingQty: data.samplingQty ?? null,
        totalQty: data.totalQty ?? null,
        totalpercent: data.totalpercent ?? null,
        parameters: data.parameters ?? [],
      }];
    }
    return undefined;
  }

  private guardLines(lines: AqrLineInput[]) {
    return lines.map((line) => ({
      productId: refIdOf(line.product),
      variantId: refIdOf(line.variant),
      kg: parseQuantity(line.arrivedQty) ?? 0,
    }));
  }

  private buildParameters(line: AqrLineInput, samplingQty: number): DeepPartial<AqrParameter>[] {
    return (line.parameters ?? []).map((p) => {
      const quantity = parseQuantity(p.quantity) ?? 0;
      const percentage = parseQuantity(p.percentage);
      return {
        qualityParameterId: String(p.qualityParameterId ?? "").trim(),
        qualityParameterName: String(p.qualityParameterName ?? "").trim(),
        qualityParameterType: p.qualityParameterType as QualityParameterType,
        quantity,
        percentage: percentage !== undefined && Number.isFinite(percentage) ? percentage : defaultPercentage(quantity, samplingQty),
      };
    });
  }

  /** New line entities for a create, with `receivedQty` snapshotted from the source. */
  private buildLines(lines: AqrLineInput[], resolved: ResolvedSource): DeepPartial<AqrProduct>[] {
    return lines.map((line) => {
      const productId = refIdOf(line.product)!;
      const variantId = refIdOf(line.variant);
      const uomId = refIdOf(line.uom);
      const sourceLine = resolved.products.find((p) => p.key === productKey(productId, variantId));
      const arrived = parseQuantity(line.arrivedQty) ?? 0;
      const sampling = parseQuantity(line.samplingQty) ?? 0;
      return {
        productName: { id: productId },
        variant: variantId ? { id: variantId } : null,
        uom: uomId ? { id: uomId } : sourceLine?.uomId ? { id: sourceLine.uomId } : null,
        receivedQty: sourceLine ? sourceLine.receivedKg : null,
        arrivedQty: arrived,
        samplingQty: sampling,
        totalQty: num(line.totalQty),
        totalpercent: num(line.totalpercent),
        remark: line.remark ?? null,
        parameters: this.buildParameters(line, sampling),
      } as DeepPartial<AqrProduct>;
    });
  }

  /**
   * Header fields that come from the source (docs §2.4: company and party are
   * taken from the source server-side; the receiving location is a default).
   */
  private sourceHeader(
    data: { companyName?: { id: string } | null; location?: { id: string } | null; fromLocation?: { id: string } | null; source?: Source | null; selectedParty?: { id: string } | null },
    source: AqrSourceRef,
    resolved: ResolvedSource,
  ): DeepPartial<Aqr> {
    const purchase = source.sourceType === "grn";
    const transfer = source.sourceType === "stock-transfer-dc";

    let partySource: Source | null = null;
    let vendorId: string | null = null;
    let farmerId: string | null = null;
    if (purchase) {
      if (resolved.partyType === "vendor" && resolved.partyId) {
        partySource = Source.VENDOR;
        vendorId = resolved.partyId;
      } else if (resolved.partyType === "farmer" && resolved.partyId) {
        partySource = Source.FARMER;
        farmerId = resolved.partyId;
      } else if (data.source === Source.VENDOR && refIdOf(data.selectedParty)) {
        partySource = Source.VENDOR;
        vendorId = refIdOf(data.selectedParty);
      } else if (data.source === Source.FARMER && refIdOf(data.selectedParty)) {
        partySource = Source.FARMER;
        farmerId = refIdOf(data.selectedParty);
      }
    }

    const companyId = resolved.companyId ?? refIdOf(data.companyName);
    const locationId = refIdOf(data.location) ?? resolved.locationId;
    const fromLocationId = transfer ? (resolved.fromLocationId ?? refIdOf(data.fromLocation)) : refIdOf(data.fromLocation);

    return {
      companyName: companyId ? { id: companyId } : null,
      location: locationId ? { id: locationId } : null,
      fromLocation: fromLocationId ? { id: fromLocationId } : null,
      source: partySource,
      selectedVendor: vendorId ? { id: vendorId } : null,
      selectedFarmer: farmerId ? { id: farmerId } : null,
      grn: source.sourceType === "grn" ? { id: source.sourceId } : null,
      deliveryChallanNo: source.sourceType === "stock-transfer-dc" ? { id: source.sourceId } : null,
      rbc: source.sourceType === "rbc" ? { id: source.sourceId } : null,
    } as DeepPartial<Aqr>;
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  // Creating a document without a configured approval flow leaves it with no
  // approvers, so reject it up front — same guard as RFPA / Deal Slip.
  private async checkApprovalFlowExists(userId: string | null | undefined, documentType: DocDefEnum): Promise<void> {
    if (!userId) {
      throw new AppError(400, 'Creator is required to validate the approval flow before creating this document.');
    }
    const approvalFlow = await this.approvalFlowService.getApprovalFlowForUserAndDepartment(userId, documentType);

    if (!approvalFlow) {
      throw new AppError(400, `Approval flow not configured for user. Please configure approval flow for ${documentType} type documents before creating.`);
    }
  }

  public async createAqr(data: CreateAqrDto): Promise<CreatedWithApproval<Aqr>> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(data.requestedBy, DocDefEnum.OPERATION);

    const requestedBy = data.requestedBy!;

    // Complete-or-nothing: every header / line problem is reported in one 400.
    const lines = this.linesFromRequest(data);
    const { errors, source } = validateAqrRequest(data, lines);
    if (errors.length > 0 || !source || !lines) {
      throw new AppError(400, errors.join("; ") || "Invalid AQR request");
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Receiving links R1–R7: the AQR points at one COMPLETE source, lists
      // every product of it once and no arrived kg exceeds the received kg.
      // The source row is locked inside this transaction so concurrent creates
      // for the same source serialise.
      const resolved = await this.receivingGuardService.resolveAndAssert({
        docType: "aqr",
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        lines: this.guardLines(lines),
        manager: queryRunner.manager,
      });

      // Absent optional fields stay undefined: TypeORM's DeepPartial has no null,
      // and an unset column is inserted as NULL anyway.
      const userRef = (value: { id: string } | null | undefined) => (refIdOf(value) ? { id: refIdOf(value)! } : undefined);
      const aqrPayload: DeepPartial<Aqr> = {
        aqrFor: data.aqrFor,
        aqrNo: await this.generateSerialNo(),
        ...this.sourceHeader(data, source, resolved),
        arrivalDate: data.arrivalDate ? (data.arrivalDate as unknown as Date) : undefined,
        purchaseBy: userRef(data.purchaseBy),
        receivedBy: userRef(data.receivedBy),
        qcCheckBy: userRef(data.qcCheckBy),
        verifiedBy: userRef(data.verifiedBy),
        totalQty: num(data.totalQty) ?? undefined,
        totalpercent: num(data.totalpercent) ?? undefined,
        remark: data.remark ?? undefined,
        products: this.buildLines(lines, resolved),
      };

      const aqr = queryRunner.manager.create(Aqr, aqrPayload);
      const savedAqr = await queryRunner.manager.save(aqr);
      const document = await this.documentbService.createDocument({
        type: DocumentTypeEnum.AQR,
        docDef: DocDefEnum.OPERATION,
        status: DocumentStatus.HOLD,
        remarks: "Document auto-created with AQR",
        lastActionBy: { id: requestedBy },
        document_type_id: savedAqr.id,
      });

      await queryRunner.commitTransaction();
      const assignment = await this.documentbService.startApprovalFlow(document.id);
      await this.invalidateAqrCache();

      return withApproval(savedAqr, assignment);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (!(error instanceof AppError)) {
        logger.error(`Error creating AQR: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Get By ID For Update ─────────────────────────────────────────────────

  public async getAqrByIdForUpdate(id: string): Promise<GetAqrForUpdateResponseDto | null> {
    const key = this.cacheKey("update", id);
    const cached = await this.cacheService.get<GetAqrForUpdateResponseDto>(key);
    if (cached) return cached;

    const result = await this.aqrRepo
      .createQueryBuilder("aqr")
      .leftJoin("aqr.deliveryChallanNo", "deliveryChallanNo")
      .leftJoin("aqr.grn", "grn")
      .leftJoin("aqr.rbc", "rbc")
      .leftJoin("aqr.companyName", "companyName")
      .leftJoin("aqr.location", "location")
      .leftJoin("aqr.selectedVendor", "selectedVendor")
      .leftJoin("aqr.selectedFarmer", "selectedFarmer")
      .leftJoin("aqr.fromLocation", "fromLocation")
      .leftJoin("aqr.product", "product")
      .leftJoin("aqr.variant", "variant")
      .leftJoin("aqr.verifiedBy", "verifiedBy")
      .leftJoin("aqr.qcCheckBy", "qcCheckBy")
      .leftJoin("aqr.receivedBy", "receivedBy")
      .leftJoin("aqr.purchaseBy", "purchaseBy")
      .leftJoin("aqr.parameters", "parameters")
      .leftJoin("aqr.products", "line")
      .leftJoin("line.productName", "lineProduct")
      .leftJoin("line.variant", "lineVariant")
      .leftJoin("line.uom", "lineUom")
      .leftJoin("line.parameters", "lineParameters")
      .select([
        "aqr.id", "aqr.aqrNo", "aqr.aqrFor", "aqr.source", "aqr.arrivalDate",
        "aqr.arrivedQty", "aqr.samplingQty", "aqr.totalQty",
        "aqr.totalpercent", "aqr.remark", "aqr.createdAt",
        "deliveryChallanNo.id", "deliveryChallanNo.challanNo",
        "grn.id", "grn.grnNo",
        "rbc.id", "rbc.rbcNo",
        "companyName.id", "location.id",
        "selectedVendor.id", "selectedFarmer.id", "fromLocation.id",
        "product.id", "product.name", "product.productCode", "product.packingType", "variant.id", "variant.variantName",
        "verifiedBy.id", "qcCheckBy.id", "receivedBy.id", "purchaseBy.id",
        "parameters.id", "parameters.qualityParameterId", "parameters.qualityParameterName",
        "parameters.qualityParameterType", "parameters.quantity", "parameters.percentage", "parameters.createdAt",
        "line.id", "line.receivedQty", "line.arrivedQty", "line.samplingQty", "line.totalQty", "line.totalpercent", "line.remark", "line.createdAt",
        "lineProduct.id", "lineProduct.name", "lineProduct.productCode", "lineProduct.packingType",
        "lineVariant.id", "lineVariant.variantName",
        "lineUom.id", "lineUom.unit",
        "lineParameters.id", "lineParameters.qualityParameterId", "lineParameters.qualityParameterName",
        "lineParameters.qualityParameterType", "lineParameters.quantity", "lineParameters.percentage", "lineParameters.createdAt",
      ])
      .where("aqr.id = :id", { id })
      .getOne();

    if (!result) return null;

    const { createdDate, createdTime } = formatDateTime(result.createdAt);
    const sourceInfo = this.sourceInfo(result);
    const products = this.linesOf(result);
    const first = products[0];

    const response: GetAqrForUpdateResponseDto = {
      id: result.id,
      aqrNo: result.aqrNo ?? null,
      aqrFor: result.aqrFor,
      companyName: result.companyName?.id || null,
      location: result.location?.id || null,
      source: result.source,
      selectedParty: result.source === "vendor"
        ? result.selectedVendor?.id || null
        : result.selectedFarmer?.id || null,
      fromLocation: result.fromLocation?.id || null,
      sourceType: sourceInfo.sourceType,
      sourceNo: sourceInfo.sourceNo,
      grnNo: sourceInfo.grnNo,
      deliveryChallanNo: sourceInfo.deliveryChallanNo,
      rbcNo: sourceInfo.rbcNo,
      arrivalDate: result.arrivalDate || null,
      purchaseBy: result.purchaseBy?.id || null,
      receivedBy: result.receivedBy?.id || null,
      qcCheckBy: result.qcCheckBy?.id || null,
      verifiedBy: result.verifiedBy?.id || null,
      remark: result.remark,
      createdDate,
      createdTime,
      products,
      product: first?.product?.id ?? null,
      variant: first?.variant?.id ?? null,
      arrivedQty: result.arrivedQty ?? (first?.arrivedQty != null ? String(first.arrivedQty) : null),
      samplingQty: result.samplingQty ?? (first?.samplingQty != null ? String(first.samplingQty) : null),
      totalQty: num(result.totalQty) ?? first?.totalQty ?? null,
      totalpercent: num(result.totalpercent) ?? first?.totalpercent ?? null,
      parameters: first?.parameters ?? [],
    };

    await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
    return response;
  }

  // ─── Get All AQRs (optimized: batch fetch instead of N+1) ─────────────────

  private listQuery(ids: string[]) {
    return this.aqrRepo
      .createQueryBuilder("aqr")
      .leftJoin("aqr.deliveryChallanNo", "dc").addSelect(["dc.id", "dc.challanNo"])
      .leftJoin("aqr.grn", "grn").addSelect(["grn.id", "grn.grnNo"])
      .leftJoin("aqr.rbc", "rbc").addSelect(["rbc.id", "rbc.rbcNo"])
      .leftJoin("aqr.companyName", "company").addSelect(["company.id", "company.name"])
      .leftJoin("aqr.location", "location").addSelect(["location.id", "location.name"])
      .leftJoin("aqr.selectedVendor", "vendor").addSelect(["vendor.id", "vendor.companyName"])
      .leftJoin("aqr.selectedFarmer", "farmer").addSelect(["farmer.id", "farmer.farmerfName", "farmer.farmerlName"])
      .leftJoin("aqr.fromLocation", "fromLoc").addSelect(["fromLoc.id", "fromLoc.name"])
      .leftJoin("aqr.product", "product").addSelect(["product.id", "product.name", "product.productCode", "product.packingType"])
      .leftJoin("aqr.variant", "variant").addSelect(["variant.id", "variant.variantName"])
      .leftJoin("aqr.products", "line").addSelect(["line.id", "line.arrivedQty", "line.samplingQty", "line.totalQty", "line.totalpercent", "line.createdAt"])
      .leftJoin("line.productName", "lineProduct").addSelect(["lineProduct.id", "lineProduct.name"])
      .leftJoin("line.variant", "lineVariant").addSelect(["lineVariant.id", "lineVariant.variantName"])
      .leftJoin("aqr.purchaseBy", "purchaseBy").addSelect(["purchaseBy.id", "purchaseBy.firstName", "purchaseBy.lastName"])
      .leftJoin("aqr.receivedBy", "receivedBy").addSelect(["receivedBy.id", "receivedBy.firstName", "receivedBy.lastName"])
      .leftJoin("aqr.qcCheckBy", "qcCheckBy").addSelect(["qcCheckBy.id", "qcCheckBy.firstName", "qcCheckBy.lastName"])
      .leftJoin("aqr.verifiedBy", "verifiedBy").addSelect(["verifiedBy.id", "verifiedBy.firstName", "verifiedBy.lastName"])
      .where("aqr.id IN (:...ids)", { ids });
  }

  /** Product summary of a list row: count, first product and summed quantities. */
  private lineSummary(rd: Aqr) {
    const lines = (rd.products ?? []).slice().sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime());
    if (lines.length > 0) {
      return {
        productCount: lines.length,
        productId: lines[0].productName?.id ?? null,
        productName: lines[0].productName?.name ?? null,
        variantId: lines[0].variant?.id ?? null,
        variantName: lines[0].variant?.variantName ?? null,
        arrivedQty: sum(lines.map((l) => num(l.arrivedQty))),
        samplingQty: sum(lines.map((l) => num(l.samplingQty))),
        totalQty: num(rd.totalQty) ?? sum(lines.map((l) => num(l.totalQty))),
        totalpercent: num(rd.totalpercent) ?? (lines.length === 1 ? num(lines[0].totalpercent) : null),
      };
    }
    return {
      productCount: rd.product ? 1 : 0,
      productId: rd.product?.id ?? null,
      productName: rd.product?.name ?? null,
      variantId: rd.variant?.id ?? null,
      variantName: rd.variant?.variantName ?? null,
      arrivedQty: num(rd.arrivedQty),
      samplingQty: num(rd.samplingQty),
      totalQty: num(rd.totalQty),
      totalpercent: num(rd.totalpercent),
    };
  }

  public async getAllAqrs(queryOptions: PaginationOptions, userId: string, isAdmin: boolean = false): Promise<{
    data: AqrListItemDto[];
    meta: { total: number; page: number; pages: number };
  }> {
    const key = this.cacheKey("list", userId, isAdmin ? 'admin' : 'user', JSON.stringify(queryOptions));
    const cached = await this.cacheService.get<{ data: AqrListItemDto[]; meta: { total: number; page: number; pages: number } }>(key);
    if (cached) return cached;

    const documents = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(userId, DocumentTypeEnum.AQR, false, queryOptions, isAdmin) as DocumentWithRelatedData[];
    const activeDocs = documents
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (activeDocs.length === 0) {
      return { data: [], meta: { total: 0, page: queryOptions.page || 1, pages: 0 } };
    }

    const aqrIds = activeDocs
      .map((d) => d.document_type_id)
      .filter((id): id is string => id !== null);

    const aqrs = await this.listQuery(aqrIds)
      .andWhere("aqr.isDeleted = false")
      .andWhere("aqr.deletedAt IS NULL")
      .getMany();

    const aqrMap = new Map(aqrs.map((a) => [a.id, a]));

    let relatedDataOnly = activeDocs.map((doc): AqrListItemDto | null => {
      if (!doc.document_type_id) return null;
      const rd = aqrMap.get(doc.document_type_id);
      if (!rd) return null;

      const selectedParty = rd.source === "vendor"
        ? rd.selectedVendor?.companyName || null
        : rd.selectedFarmer
          ? `${rd.selectedFarmer.farmerfName ?? ""} ${rd.selectedFarmer.farmerlName ?? ""}`.trim()
          : null;
      const sourceInfo = this.sourceInfo(rd);
      const summary = this.lineSummary(rd);

      return {
        documentId: doc.id,
        overAllStatus: doc.status,
        createdBy: `${doc.lastActionBy?.firstName || ""} ${doc.lastActionBy?.lastName || ""}`.trim(),
        createdDate: formatDateTime(doc.createdAt).createdDate,
        createdTime: formatDateTime(doc.createdAt).createdTime,
        id: rd.id,
        aqrFor: rd.aqrFor || null,
        aqrNo: rd.aqrNo || null,
        companyName: rd.companyName?.name || null,
        location: rd.location?.name || null,
        source: rd.source || null,
        selectedParty,
        sourceType: sourceInfo.sourceType,
        sourceNo: sourceInfo.sourceNo,
        grnNo: sourceInfo.grnNo?.grnNo ?? null,
        deliveryChallanNo: sourceInfo.deliveryChallanNo?.challanNo ?? null,
        rbcNo: sourceInfo.rbcNo?.rbcNo ?? null,
        fromLocation: rd.fromLocation?.name || null,
        productCount: summary.productCount,
        product: summary.productName,
        variant: summary.variantName,
        arrivalDate: (rd.arrivalDate as unknown as string) || null,
        arrivedQty: fixed2(summary.arrivedQty),
        samplingQty: fixed2(summary.samplingQty),
        totalQty: fixed2(summary.totalQty),
        totalpercent: summary.totalpercent,
        remark: rd.remark || null,
        purchaseBy: rd.purchaseBy ? `${rd.purchaseBy.firstName ?? ""} ${rd.purchaseBy.lastName ?? ""}`.trim() : null,
        receivedBy: rd.receivedBy ? `${rd.receivedBy.firstName ?? ""} ${rd.receivedBy.lastName ?? ""}`.trim() : null,
        qcCheckBy: rd.qcCheckBy ? `${rd.qcCheckBy.firstName ?? ""} ${rd.qcCheckBy.lastName ?? ""}`.trim() : null,
        verifiedBy: rd.verifiedBy ? `${rd.verifiedBy.firstName ?? ""} ${rd.verifiedBy.lastName ?? ""}`.trim() : null,
      };
    }).filter((item): item is AqrListItemDto => item !== null);

    // Search
    const { search } = queryOptions;
    if (search?.trim()) {
      const term = search.toLowerCase();
      const stringify = (obj: any): string => {
        if (obj == null) return "";
        if (typeof obj === "object") return Object.values(obj).map(stringify).join(" ");
        return String(obj);
      };
      relatedDataOnly = relatedDataOnly.filter((item) => stringify(item).toLowerCase().includes(term));
    }

    // Sort
    if (queryOptions.sort) {
      const [field, direction] = queryOptions.sort.split(":");
      const sortOrder = direction?.toUpperCase() === "DESC" ? -1 : 1;
      const getVal = (obj: any, path: string) => path.split(".").reduce((o, k) => o?.[k], obj);
      relatedDataOnly.sort((a, b) => {
        const valA = getVal(a, field);
        const valB = getVal(b, field);
        if (valA == null && valB == null) return 0;
        if (valA == null) return -1 * sortOrder;
        if (valB == null) return 1 * sortOrder;
        if (!isNaN(valA) && !isNaN(valB)) return (Number(valA) - Number(valB)) * sortOrder;
        return String(valA).localeCompare(String(valB)) * sortOrder;
      });
    }

    const response = {
      data: relatedDataOnly,
      meta: {
        total: relatedDataOnly.length,
        page: queryOptions.page || 1,
        pages: Math.ceil(relatedDataOnly.length / (queryOptions.limit || 10)),
      },
    };

    await this.cacheService.set(key, response, CACHE_TTL);
    return response;
  }


  // ─── Get Recycle Bin (optimized: batch fetch) ─────────────────────────────

  public async getAllRecycleBinAqrs(queryOptions: PaginationOptions, userId: string): Promise<{
    data: any[];
    meta: { total: number; page: number; pages: number };
  }> {
    const key = this.cacheKey("recycle", userId, JSON.stringify(queryOptions));
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const documents = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(userId, DocumentTypeEnum.AQR, true) as DocumentWithRelatedData[];
    const deletedDocs = documents;

    if (deletedDocs.length === 0) {
      return { data: [], meta: { total: 0, page: queryOptions.page || 1, pages: 0 } };
    }

    const aqrIds = deletedDocs.map((d) => d.document_type_id).filter((id): id is string => !!id);
    const aqrs = await this.listQuery(aqrIds)
      .leftJoinAndSelect("aqr.parameters", "parameters")
      .leftJoinAndSelect("line.parameters", "lineParameters")
      .andWhere("aqr.isDeleted = true")
      .getMany();

    const aqrMap = new Map(aqrs.map((a) => [a.id, a]));

    let relatedDataOnly = deletedDocs.map((doc) => {
      const rd = aqrMap.get(doc.document_type_id ?? '');
      if (!rd) return null;
      const selectedParty = rd.source === "vendor"
        ? rd.selectedVendor?.id || null
        : rd.selectedFarmer?.id || null;
      const sourceInfo = this.sourceInfo(rd);
      const summary = this.lineSummary(rd);
      const products = this.linesOf(rd);
      return {
        documentId: doc.id,
        overAllStatus: doc.status,
        createdBy: `${doc.lastActionBy?.firstName || ""} ${doc.lastActionBy?.lastName || ""}`.trim(),
        createdDate: formatDateTime(doc.createdAt).createdDate,
        createdTime: formatDateTime(doc.createdAt).createdTime,
        id: rd.id || null,
        aqrNo: rd.aqrNo || null,
        aqrFor: rd.aqrFor || null,
        companyName: rd.companyName?.id || null,
        location: rd.location?.id || null,
        source: rd.source || null,
        selectedParty,
        sourceType: sourceInfo.sourceType,
        sourceNo: sourceInfo.sourceNo,
        grnNo: sourceInfo.grnNo?.grnNo ?? null,
        deliveryChallanNo: sourceInfo.deliveryChallanNo?.challanNo ?? null,
        rbcNo: sourceInfo.rbcNo?.rbcNo ?? null,
        fromLocation: rd.fromLocation?.id || null,
        productCount: summary.productCount,
        product: summary.productId,
        productName: summary.productName,
        productCode: rd.product?.productCode || products[0]?.product?.productCode || null,
        packingType: rd.product?.packingType || products[0]?.product?.packingType || null,
        variant: summary.variantId,
        arrivalDate: rd.arrivalDate || null,
        arrivedQty: summary.arrivedQty,
        samplingQty: summary.samplingQty,
        totalQty: summary.totalQty,
        totalpercent: summary.totalpercent,
        remark: rd.remark || null,
        purchaseBy: rd.purchaseBy?.firstName || null,
        receivedBy: rd.receivedBy?.firstName || null,
        qcCheckBy: rd.qcCheckBy?.firstName || null,
        verifiedBy: rd.verifiedBy?.firstName || null,
        products,
        parameters: products[0]?.parameters ?? [],
      };
    }).filter(Boolean);

    const { search } = queryOptions;
    if (search?.trim()) {
      const term = search.toLowerCase();
      const stringify = (obj: any): string => {
        if (obj == null) return "";
        if (typeof obj === "object") return Object.values(obj).map(stringify).join(" ");
        return String(obj);
      };
      relatedDataOnly = relatedDataOnly.filter((item) => stringify(item).toLowerCase().includes(term));
    }

    if (queryOptions.sort) {
      const [field, direction] = queryOptions.sort.split(":");
      const sortOrder = direction?.toUpperCase() === "DESC" ? -1 : 1;
      const getVal = (obj: any, path: string) => path.split(".").reduce((o, k) => o?.[k], obj);
      relatedDataOnly.sort((a, b) => {
        const valA = getVal(a, field);
        const valB = getVal(b, field);
        if (valA == null && valB == null) return 0;
        if (valA == null) return -1 * sortOrder;
        if (valB == null) return 1 * sortOrder;
        if (!isNaN(valA) && !isNaN(valB)) return (Number(valA) - Number(valB)) * sortOrder;
        return String(valA).localeCompare(String(valB)) * sortOrder;
      });
    }

    const response = {
      data: relatedDataOnly,
      meta: {
        total: relatedDataOnly.length,
        page: queryOptions.page || 1,
        pages: Math.ceil(relatedDataOnly.length / (queryOptions.limit || 10)),
      },
    };

    await this.cacheService.set(key, response, CACHE_TTL);
    return response;
  }

  // ─── Get AQR By ID For View (with document approval info) ─────────────────

  public async getAQRByIdForView(docid: string, userId: string, isAdmin: boolean = false): Promise<GetAqrByIdForViewResponseDto | null> {
    const key = this.cacheKey("view", docid, userId);
    const cached = await this.cacheService.get<GetAqrByIdForViewResponseDto>(key);
    if (cached) return cached;

    const document = await this.docSingalApproverService.getSingleApprovalDocumentById(docid, userId, isAdmin);
    if (!document) return null;

    const id = document.documentTypeId;
    if (!id) return null;

    const aqr = await this.aqrRepo
      .createQueryBuilder('aqr')
      .leftJoin('aqr.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoin('aqr.grn', 'grn')
      .leftJoin('aqr.rbc', 'rbc')
      .leftJoin('rbc.customerName', 'customer')
      .leftJoin('aqr.companyName', 'companyName')
      .leftJoin('aqr.location', 'location')
      .leftJoin('aqr.selectedVendor', 'selectedVendor')
      .leftJoin('selectedVendor.vendorSaleInfo', 'vendorSaleInfo')
      .leftJoin('selectedVendor.officeAddress', 'vendorOfficeAddress')
      .leftJoin('aqr.selectedFarmer', 'selectedFarmer')
      .leftJoin('selectedFarmer.residensialAddress', 'residensialAddress')
      .leftJoin('selectedFarmer.farmAddress', 'farmAddress')
      .leftJoin('aqr.fromLocation', 'fromLocation')
      .leftJoin('aqr.product', 'product')
      .leftJoin('aqr.variant', 'variant')
      .leftJoin('aqr.parameters', 'parameters')
      .leftJoin('aqr.products', 'line')
      .leftJoin('line.productName', 'lineProduct')
      .leftJoin('line.variant', 'lineVariant')
      .leftJoin('line.uom', 'lineUom')
      .leftJoin('line.parameters', 'lineParameters')
      .leftJoin('aqr.purchaseBy', 'purchaseBy')
      .leftJoin('aqr.receivedBy', 'receivedBy')
      .leftJoin('aqr.qcCheckBy', 'qcCheckBy')
      .leftJoin('aqr.verifiedBy', 'verifiedBy')
      .select([
        'aqr.id', 'aqr.aqrNo', 'aqr.aqrFor', 'aqr.source', 'aqr.arrivalDate',
        'aqr.arrivedQty', 'aqr.samplingQty', 'aqr.totalQty',
        'aqr.totalpercent', 'aqr.remark', 'aqr.createdAt',
        'deliveryChallanNo.id', 'deliveryChallanNo.challanNo',
        'grn.id', 'grn.grnNo',
        'rbc.id', 'rbc.rbcNo',
        'customer.id', 'customer.organisationName', 'customer.customerCode',
        'companyName.id',
        'location.name',
        'selectedVendor.id', 'selectedVendor.companyName', 'selectedVendor.vendorCode',
        'selectedVendor.officeContactNo', 'selectedVendor.officeEmail',
        'vendorOfficeAddress.id', 'vendorOfficeAddress.address1', 'vendorOfficeAddress.address2',
        'vendorOfficeAddress.location', 'vendorOfficeAddress.city', 'vendorOfficeAddress.state', 'vendorOfficeAddress.pincode',
        'vendorSaleInfo.contactFName', 'vendorSaleInfo.contactLName',
        'selectedFarmer.id', 'selectedFarmer.farmerfName', 'selectedFarmer.farmerlName',
        'selectedFarmer.farmerCode', 'selectedFarmer.primaryMobileNo', 'selectedFarmer.email',
        'residensialAddress.id', 'residensialAddress.address1', 'residensialAddress.address2',
        'residensialAddress.location', 'residensialAddress.city', 'residensialAddress.state', 'residensialAddress.pincode',
        'farmAddress.id', 'farmAddress.address1', 'farmAddress.address2',
        'farmAddress.location', 'farmAddress.city', 'farmAddress.state', 'farmAddress.pincode',
        'fromLocation.name',
        'product.id', 'product.name', 'product.productCode', 'product.packingType',
        'variant.id', 'variant.variantName',
        'parameters.id', 'parameters.qualityParameterId', 'parameters.qualityParameterName',
        'parameters.qualityParameterType', 'parameters.quantity', 'parameters.percentage', 'parameters.createdAt',
        'line.id', 'line.receivedQty', 'line.arrivedQty', 'line.samplingQty', 'line.totalQty', 'line.totalpercent', 'line.remark', 'line.createdAt',
        'lineProduct.id', 'lineProduct.name', 'lineProduct.productCode', 'lineProduct.packingType',
        'lineVariant.id', 'lineVariant.variantName',
        'lineUom.id', 'lineUom.unit',
        'lineParameters.id', 'lineParameters.qualityParameterId', 'lineParameters.qualityParameterName',
        'lineParameters.qualityParameterType', 'lineParameters.quantity', 'lineParameters.percentage', 'lineParameters.createdAt',
        'purchaseBy.firstName', 'purchaseBy.lastName',
        'receivedBy.firstName', 'receivedBy.lastName',
        'qcCheckBy.firstName', 'qcCheckBy.lastName',
        'verifiedBy.firstName', 'verifiedBy.lastName',
      ])
      .where('aqr.id = :id', { id })
      .getOne();

    if (!aqr) throw new AppError(404, 'AQR not found');

    const { createdDate, createdTime } = formatDateTime(aqr.createdAt);
    const mapUser = (u: any): string | null => u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : null;

    const selectedParty: VendorPartyDto | FarmerPartyDto | null = aqr.source === 'vendor'
      ? aqr.selectedVendor ? {
        id: aqr.selectedVendor.id,
        companyName: aqr.selectedVendor.companyName ?? null,
        vendorCode: aqr.selectedVendor.vendorCode ?? null,
        officeContactNo: aqr.selectedVendor.officeContactNo ?? null,
        officeEmail: aqr.selectedVendor.officeEmail ?? null,
        officeAddress: aqr.selectedVendor.officeAddress ?? null,
        contactPersonName: aqr.selectedVendor.vendorSaleInfo
          ? `${aqr.selectedVendor.vendorSaleInfo.contactFName} ${aqr.selectedVendor.vendorSaleInfo.contactLName}`
          : null,
      } : null
      : aqr.selectedFarmer ? {
        id: aqr.selectedFarmer.id,
        fullName: `${aqr.selectedFarmer.farmerfName ?? ''} ${aqr.selectedFarmer.farmerlName ?? ''}`.trim(),
        farmerCode: aqr.selectedFarmer.farmerCode ?? null,
        primaryMobileNo: aqr.selectedFarmer.primaryMobileNo ?? null,
        email: aqr.selectedFarmer.email ?? null,
        residensialAddress: aqr.selectedFarmer.residensialAddress ?? null,
        farmAddress: aqr.selectedFarmer.farmAddress ?? null,
      } : null;

    // The customer of an RBC source is read through the RBC, not stored on the AQR.
    const rbcCustomer = aqr.rbc?.customerName;
    const customer: CustomerPartyDto | null = rbcCustomer
      ? { id: rbcCustomer.id, organisationName: rbcCustomer.organisationName ?? null, customerCode: rbcCustomer.customerCode ?? null }
      : null;

    const sourceInfo = this.sourceInfo(aqr);
    const products = this.linesOf(aqr);
    const first = products[0];

    const response: GetAqrByIdForViewResponseDto = {
      documentId: document.documentId,
      overAllStatus: document.status,
      createdBy: document.createdBy,
      createdDate,
      createdTime,
      approvalSummary: document.approvalSummary ?? null,
      id: aqr.id,
      aqrNo: aqr.aqrNo ?? null,
      aqrFor: aqr.aqrFor,
      companyName: aqr.companyName?.id ?? null,
      location: aqr.location?.name ?? null,
      source: aqr.source,
      selectedParty,
      customer,
      sourceType: sourceInfo.sourceType,
      sourceNo: sourceInfo.sourceNo,
      grnNo: sourceInfo.grnNo,
      deliveryChallanNo: sourceInfo.deliveryChallanNo,
      rbcNo: sourceInfo.rbcNo,
      fromLocation: aqr.fromLocation?.name ?? null,
      arrivalDate: aqr.arrivalDate ?? null,
      remark: aqr.remark ?? null,
      purchaseBy: mapUser(aqr.purchaseBy),
      receivedBy: mapUser(aqr.receivedBy),
      qcCheckBy: mapUser(aqr.qcCheckBy),
      verifiedBy: mapUser(aqr.verifiedBy),
      products,
      productCount: products.length,
      product: first?.product?.name ?? null,
      productCode: first?.product?.productCode ?? null,
      packingType: first?.product?.packingType ?? null,
      variant: first?.variant?.variantName ?? null,
      arrivedQty: aqr.arrivedQty ?? (first?.arrivedQty != null ? String(first.arrivedQty) : null),
      samplingQty: aqr.samplingQty ?? (first?.samplingQty != null ? String(first.samplingQty) : null),
      totalQty: num(aqr.totalQty) ?? first?.totalQty ?? null,
      totalpercent: num(aqr.totalpercent) ?? first?.totalpercent ?? null,
      parameters: first?.parameters ?? [],
    };

    await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
    return response;
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /** An AQR can only be edited while its approval document is still on hold. */
  private async assertEditable(aqr: Aqr): Promise<void> {
    const document = await this.documentbRepository.findOne({
      where: { document_type_id: aqr.id, type: DocumentTypeEnum.AQR },
      order: { createdAt: "DESC" },
    });
    if (!document) return; // no companion document (very old rows): nothing in approval
    if (document.status !== DocumentStatus.HOLD) {
      throw new AppError(
        409,
        `${aqr.aqrNo ?? 'This AQR'} cannot be edited: its approval status is ${document.status}. Only AQRs on hold can be changed.`,
      );
    }
  }

  /** The stored lines as request lines, for an update that did not resend them. */
  private storedLinesAsInput(aqr: Aqr): AqrLineInput[] | undefined {
    if ((aqr.products ?? []).length > 0) {
      return aqr.products.map((line) => ({
        id: line.id,
        product: line.productName ? { id: line.productName.id } : null,
        variant: line.variant ? { id: line.variant.id } : null,
        uom: line.uom ? { id: line.uom.id } : null,
        arrivedQty: num(line.arrivedQty),
        samplingQty: num(line.samplingQty),
        totalQty: num(line.totalQty),
        totalpercent: num(line.totalpercent),
        remark: line.remark ?? null,
        parameters: (line.parameters ?? []).map((p) => ({
          qualityParameterId: p.qualityParameterId,
          qualityParameterName: p.qualityParameterName,
          qualityParameterType: p.qualityParameterType,
          quantity: num(p.quantity),
          percentage: num(p.percentage),
        })),
      }));
    }
    if (aqr.product) {
      return [{
        product: { id: aqr.product.id },
        variant: aqr.variant ? { id: aqr.variant.id } : null,
        arrivedQty: num(aqr.arrivedQty) ?? 0,
        samplingQty: num(aqr.samplingQty) ?? 0,
        totalQty: num(aqr.totalQty),
        totalpercent: num(aqr.totalpercent),
        parameters: (aqr.parameters ?? []).map((p) => ({
          qualityParameterId: p.qualityParameterId,
          qualityParameterName: p.qualityParameterName,
          qualityParameterType: p.qualityParameterType,
          quantity: num(p.quantity),
          percentage: num(p.percentage),
        })),
      }];
    }
    return undefined;
  }

  /**
   * Writes the lines of an update. The product set is fixed by the source (the
   * guard has already checked it), so lines are matched by product + variant
   * (or by id) and only their quantities, UOM, remark and parameters change;
   * parameters are replaced wholesale per line.
   */
  private async applyLineUpdate(aqr: Aqr, lines: AqrLineInput[], resolved: ResolvedSource, manager: EntityManager): Promise<void> {
    const existingLines = aqr.products ?? [];
    const byKey = new Map(existingLines.map((l) => [productKey(l.productName?.id ?? '', l.variant?.id ?? null), l]));
    const byId = new Map(existingLines.map((l) => [l.id, l]));
    const kept = new Set<string>();
    const next: AqrProduct[] = [];

    for (const input of lines) {
      const productId = refIdOf(input.product)!;
      const variantId = refIdOf(input.variant);
      const key = productKey(productId, variantId);
      const inputId = typeof input.id === 'string' && input.id ? input.id : null;

      let line = byKey.get(key) ?? (inputId ? byId.get(inputId) : undefined) ?? null;
      if (line && kept.has(line.id)) line = null;

      if (line) {
        kept.add(line.id);
        if ((line.parameters ?? []).length > 0) await manager.remove(line.parameters);
      } else {
        line = manager.create(AqrProduct, { aqr: { id: aqr.id } } as DeepPartial<AqrProduct>);
      }

      const sourceLine = resolved.products.find((p) => p.key === key);
      const uomId = refIdOf(input.uom);
      const arrived = parseQuantity(input.arrivedQty) ?? 0;
      const sampling = parseQuantity(input.samplingQty) ?? 0;

      line.productName = { id: productId } as AqrProduct['productName'];
      line.variant = (variantId ? { id: variantId } : null) as AqrProduct['variant'];
      line.uom = (uomId ? { id: uomId } : line.uom?.id ? { id: line.uom.id } : sourceLine?.uomId ? { id: sourceLine.uomId } : null) as AqrProduct['uom'];
      line.receivedQty = (sourceLine ? sourceLine.receivedKg : num(line.receivedQty)) as number;
      line.arrivedQty = arrived;
      line.samplingQty = sampling;
      line.totalQty = num(input.totalQty) as number;
      line.totalpercent = num(input.totalpercent) as number;
      line.remark = (input.remark ?? null) as string;
      line.parameters = this.buildParameters(input, sampling).map((p) => manager.create(AqrParameter, p));
      next.push(line);
    }

    const removed = existingLines.filter((l) => !kept.has(l.id));
    if (removed.length > 0) await manager.remove(removed);

    // A legacy AQR that is edited becomes a lines AQR: its header-level
    // parameters are superseded by the ones on the line.
    if (existingLines.length === 0) {
      const legacyParams = await manager
        .getRepository(AqrParameter)
        .createQueryBuilder("param")
        .innerJoin("param.aqr", "parent")
        .leftJoin("param.aqrProduct", "line")
        .where("parent.id = :id", { id: aqr.id })
        .andWhere("line.id IS NULL")
        .getMany();
      if (legacyParams.length > 0) await manager.remove(legacyParams);
      aqr.parameters = [];
    }

    aqr.products = next;
  }

  public async updateAqr(id: string, data: UpdateAqrDto, updatedBy: string): Promise<Aqr | null> {
    const existingAqr = await this.aqrRepo.findOne({
      where: { id },
      relations: [
        'grn', 'deliveryChallanNo', 'rbc',
        'companyName', 'location', 'fromLocation', 'selectedVendor', 'selectedFarmer',
        'purchaseBy', 'receivedBy', 'qcCheckBy', 'verifiedBy',
        'product', 'variant', 'parameters',
        'products', 'products.productName', 'products.variant', 'products.uom', 'products.parameters',
      ],
    });
    if (!existingAqr) return null;

    await this.assertEditable(existingAqr);

    // Header + lines as they will be after the update, validated as a whole.
    const header = {
      aqrFor: data.aqrFor ?? existingAqr.aqrFor,
      grnNo: data.grnNo !== undefined ? data.grnNo : existingAqr.grn ? { id: existingAqr.grn.id } : null,
      deliveryChallanNo: data.deliveryChallanNo !== undefined ? data.deliveryChallanNo : existingAqr.deliveryChallanNo ? { id: existingAqr.deliveryChallanNo.id } : null,
      rbcNo: data.rbcNo !== undefined ? data.rbcNo : existingAqr.rbc ? { id: existingAqr.rbc.id } : null,
    };
    const lines = this.linesFromRequest(data) ?? this.storedLinesAsInput(existingAqr);
    const { errors, source } = validateAqrRequest(header, lines);
    if (errors.length > 0 || !source || !lines) {
      throw new AppError(400, errors.join("; ") || "Invalid AQR request");
    }

    const oldData = { ...existingAqr };

    const updatedAqr = await this.dataSource.transaction(async (manager) => {
      // Receiving links: the edited AQR must still match its source exactly.
      const resolved = await this.receivingGuardService.resolveAndAssert({
        docType: "aqr",
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        lines: this.guardLines(lines),
        excludeDocId: id,
        manager,
      });

      const partyInput = {
        companyName: data.companyName !== undefined ? data.companyName : existingAqr.companyName ? { id: existingAqr.companyName.id } : null,
        location: data.location !== undefined ? data.location : existingAqr.location ? { id: existingAqr.location.id } : null,
        fromLocation: data.fromLocation !== undefined ? data.fromLocation : existingAqr.fromLocation ? { id: existingAqr.fromLocation.id } : null,
        source: data.source !== undefined ? data.source : existingAqr.source,
        selectedParty: data.selectedParty !== undefined
          ? data.selectedParty
          : existingAqr.source === Source.VENDOR && existingAqr.selectedVendor
            ? { id: existingAqr.selectedVendor.id }
            : existingAqr.source === Source.FARMER && existingAqr.selectedFarmer
              ? { id: existingAqr.selectedFarmer.id }
              : null,
      };
      Object.assign(existingAqr, { aqrFor: header.aqrFor }, this.sourceHeader(partyInput, source, resolved));

      if (data.arrivalDate !== undefined) existingAqr.arrivalDate = (data.arrivalDate || null) as unknown as Date;
      if (data.remark !== undefined) existingAqr.remark = data.remark as string;
      if (data.totalQty !== undefined) existingAqr.totalQty = num(data.totalQty) as number;
      if (data.totalpercent !== undefined) existingAqr.totalpercent = num(data.totalpercent) as number;
      const userRef = (value: { id: string } | null | undefined) => (refIdOf(value) ? { id: refIdOf(value)! } : null);
      if (data.purchaseBy !== undefined) existingAqr.purchaseBy = userRef(data.purchaseBy) as Aqr['purchaseBy'];
      if (data.receivedBy !== undefined) existingAqr.receivedBy = userRef(data.receivedBy) as Aqr['receivedBy'];
      if (data.qcCheckBy !== undefined) existingAqr.qcCheckBy = userRef(data.qcCheckBy) as Aqr['qcCheckBy'];
      if (data.verifiedBy !== undefined) existingAqr.verifiedBy = userRef(data.verifiedBy) as Aqr['verifiedBy'];

      await this.applyLineUpdate(existingAqr, lines, resolved, manager);
      return manager.save(existingAqr);
    });

    await this.auditLogService.logChange("AQR", id, oldData, updatedAqr, updatedBy);
    await this.invalidateAqrCache(id);

    return updatedAqr;
  }

  // ─── Delete (schedule) ────────────────────────────────────────────────────

  public async deleteAqr(id: string): Promise<DeleteAqrResultDto | null> {
    const aqr = await this.aqrRepo.findOne({ where: { id } });
    if (!aqr) throw new AppError(404, `AQR with ID ${id} not found`);

    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    sixMonthsFromNow.setHours(0, 0, 0, 0);

    aqr.deletionScheduledAt = sixMonthsFromNow;
    await this.aqrRepo.save(aqr);
    await this.invalidateAqrCache(id);

    return { aqrNo: aqr.aqrNo };
  }

  // ─── Delete Multiple ──────────────────────────────────────────────────────

  public async deleteMultipleAqrs(ids: string[]): Promise<BulkDeleteAqrResultDto> {
    const success: { id: string; aqrNo: string }[] = [];
    const failed: { id: string; reason: string }[] = [];

    for (const id of ids) {
      try {
        const aqr = await this.aqrRepo.findOne({ where: { id } });
        if (!aqr) { failed.push({ id, reason: "AQR not found" }); continue; }

        const relatedDocument = await this.documentbRepository.findOne({ where: { document_type_id: aqr.id } });
        if (relatedDocument) {
          await this.documentbRepository.softDelete(relatedDocument.id);
          await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);
        }

        await this.aqrRepo.softDelete(aqr.id);
        await this.aqrRepo.update(aqr.id, { isDeleted: true } as any);
        success.push({ id, aqrNo: aqr.aqrNo });
      } catch (error: any) {
        failed.push({ id, reason: error.message || "Unknown error" });
      }
    }

    await this.invalidateAqrCache();
    return { success, failed, message: `Deletion completed. Success: ${success.length}, Failed: ${failed.length}` };
  }
}
