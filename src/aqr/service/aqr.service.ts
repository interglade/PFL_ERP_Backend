import { inject, injectable } from "inversify";
import { TYPES } from "../../types";

import AppError from "../../utils/appError";
import { buildQuery, PaginationOptions } from "../../utils/pagination";
import { formatDateTime } from "../../utils/dateUtils";

import { DocumentStatus, DocumentTypeEnum } from "../../approvalFlow/entity/docuemnt.entity";
import { DocumentTypeEnum as DocDefEnum } from "../../documentDef/entity/documentdef.entity";

import { SelectQueryBuilder, DataSource, In, DeepPartial } from "typeorm";

import { CacheService } from "../../global/cache.service";
import { AqrListItemDto, BulkDeleteAqrResultDto, CreateAqrDto, DeleteAqrResultDto, FarmerPartyDto, GetAqrByIdForViewResponseDto, GetAqrForUpdateResponseDto, UpdateAqrDto, VendorPartyDto } from "../dto/aqr.dto";
import { Source } from "../../utils/status.enum";
import { AqrRepository } from "../repository/aqr.repository";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { DocSingalApproverService } from "../../approvalFlow/service/DocSingalApproverService.service";
import { DocumentbService, DocumentWithRelatedData } from "../../approvalFlow/service/documentb.service";
import { DocumentbRepository } from "../../approvalFlow/repository/documentb.repository";
import { ApprovalFlowService } from "../../approvalFlow/service/approvalFlow.service";
import { Aqr } from "../entity/aqr.entity";


const CACHE_PREFIX = "aqr";
const CACHE_TTL = 120; // 2 minutes for list data
const CACHE_TTL_DETAIL = 300; // 5 minutes for detail views

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

  public async createAqr(data: CreateAqrDto): Promise<Aqr> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(data.requestedBy, DocDefEnum.OPERATION);

    const requestedBy = data.requestedBy!;

    // const approvalFlow = await this.approvalFlowService.findApprovalFlowForLoggedUser(
    //   requestedBy,
    //   DocDefEnum.OPERATION,
    // );
    // if (!approvalFlow) {
    //   throw new AppError(
    //     400,
    //     "No approval flow configured for this user. Please contact the admin to create an approval flow before creating a AQR.",
    //   );
    // }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (!data.arrivalDate || data.arrivalDate === "") data.arrivalDate = null;

      // Map selectedParty → selectedVendor / selectedFarmer
      if (data.source === Source.VENDOR && data.selectedParty) {
        (data as any).selectedVendor = data.selectedParty;  // already { id }
        (data as any).selectedFarmer = null;
      } else if (data.source === Source.FARMER && data.selectedParty) {
        (data as any).selectedFarmer = data.selectedParty;  // already { id }
        (data as any).selectedVendor = null;
      }
      delete (data as any).selectedParty;
      // Safe to spread — convert null relations to undefined for TypeORM compatibility
      const aqrPayload = {
        ...data,
        aqrNo: await this.generateSerialNo(),
        deliveryChallanNo: data.deliveryChallanNo ?? undefined,
        fromLocation: data.fromLocation ?? undefined,
        variant: data.variant ?? undefined,
        purchaseBy: data.purchaseBy ?? undefined,
        receivedBy: data.receivedBy ?? undefined,
        qcCheckBy: data.qcCheckBy ?? undefined,
        verifiedBy: data.verifiedBy ?? undefined,
        companyName: data.companyName ?? undefined,
        location: data.location ?? undefined,
        product: data.product ?? undefined,
      } as DeepPartial<Aqr>;

      const aqr = queryRunner.manager.create(this.aqrRepo.target, aqrPayload);
      const savedAqr = await queryRunner.manager.save(aqr);
      const actualAqr = Array.isArray(savedAqr) ? (savedAqr[0] as Aqr) : (savedAqr as Aqr);
      const document = await this.documentbService.createDocument({
        type: DocumentTypeEnum.AQR,
        docDef: DocDefEnum.OPERATION,
        status: DocumentStatus.HOLD,
        remarks: "Document auto-created with AQR",
        lastActionBy: { id: requestedBy },
        document_type_id: actualAqr.id,
      });

      await queryRunner.commitTransaction();
      await this.documentbService.startApprovalFlow(document.id);
      await this.invalidateAqrCache();

      return savedAqr as Aqr;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }


  // ─── Get By ID (for edit form) ────────────────────────────────────────────



  // ─── Get By ID For Update ─────────────────────────────────────────────────

  public async getAqrByIdForUpdate(id: string): Promise<GetAqrForUpdateResponseDto | null> {
    const key = this.cacheKey("update", id);
    const cached = await this.cacheService.get<GetAqrForUpdateResponseDto>(key);
    if (cached) return cached;

    const result = await this.aqrRepo
      .createQueryBuilder("aqr")
      .leftJoin("aqr.deliveryChallanNo", "deliveryChallanNo")
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
      .select([
        "aqr.id", "aqr.aqrFor", "aqr.source", "aqr.arrivalDate",
        "aqr.arrivedQty", "aqr.samplingQty", "aqr.totalQty",
        "aqr.totalpercent", "aqr.remark", "aqr.createdAt",
        "deliveryChallanNo.id", "companyName.id", "location.id",
        "selectedVendor.id", "selectedFarmer.id", "fromLocation.id",
        "product.id", "variant.id",
        "verifiedBy.id", "qcCheckBy.id", "receivedBy.id", "purchaseBy.id",
        "parameters.id", "parameters.qualityParameterId", "parameters.qualityParameterName",
        "parameters.qualityParameterType", "parameters.quantity", "parameters.percentage",
      ])
      .where("aqr.id = :id", { id })
      .getOne();

    if (!result) return null;

    const { createdDate, createdTime } = formatDateTime(result.createdAt);

    const toIsoDate = (val: string | null): string | null => {
      if (!val) return null;
      const parts = val.split("-");
      if (parts.length !== 3) return null;
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    };

    const response: GetAqrForUpdateResponseDto = {
      id: result.id,
      aqrFor: result.aqrFor,
      companyName: result.companyName?.id || null,
      location: result.location?.id || null,
      source: result.source,
      selectedParty: result.source === "vendor"
        ? result.selectedVendor?.id || null
        : result.selectedFarmer?.id || null,
      deliveryChallanNo: result.deliveryChallanNo?.id || null,
      fromLocation: result.fromLocation?.id || null,
      product: result.product?.id || null,
      variant: result.variant?.id || null,
      arrivalDate: result.arrivalDate || null,
      arrivedQty: result.arrivedQty,
      samplingQty: result.samplingQty,
      purchaseBy: result.purchaseBy?.id || null,
      receivedBy: result.receivedBy?.id || null,
      qcCheckBy: result.qcCheckBy?.id || null,
      verifiedBy: result.verifiedBy?.id || null,
      totalQty: result.totalQty,
      totalpercent: result.totalpercent,
      remark: result.remark,
      createdDate,
      createdTime,
      parameters: (result.parameters ?? []).map((param) => ({
        id: param.id,
        qualityParameterId: param.qualityParameterId,
        qualityParameterName: param.qualityParameterName,
        qualityParameterType: param.qualityParameterType,
        quantity: param.quantity != null ? Number(param.quantity) : null,
        percentage: param.percentage != null ? Number(param.percentage) : null,
      })),
    };

    await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
    return response;
  }




  // ─── Get All AQRs (optimized: batch fetch instead of N+1) ─────────────────

  public async getAllAqrs(queryOptions: PaginationOptions, userId: string): Promise<{
    data: AqrListItemDto[];
    meta: { total: number; page: number; pages: number };
  }> {
    const key = this.cacheKey("list", userId, JSON.stringify(queryOptions));
    const cached = await this.cacheService.get<{ data: AqrListItemDto[]; meta: { total: number; page: number; pages: number } }>(key);
    if (cached) return cached;

    const documents = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(userId, DocumentTypeEnum.AQR, false, queryOptions) as DocumentWithRelatedData[];
    const activeDocs = documents
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (activeDocs.length === 0) {
      return { data: [], meta: { total: 0, page: queryOptions.page || 1, pages: 0 } };
    }

    // const aqrIds = activeDocs.map((d) => d.document_type_id).filter(Boolean);
    const aqrIds = activeDocs
      .map((d) => d.document_type_id)
      .filter((id): id is string => id !== null);

    const aqrs = await this.aqrRepo
      .createQueryBuilder("aqr")
      .leftJoin("aqr.deliveryChallanNo", "dc").addSelect(["dc.challanNo"])
      .leftJoin("aqr.companyName", "company").addSelect(["company.name"])
      .leftJoin("aqr.location", "location").addSelect(["location.name"])
      .leftJoin("aqr.selectedVendor", "vendor").addSelect(["vendor.companyName"])
      .leftJoin("aqr.selectedFarmer", "farmer").addSelect(["farmer.farmerfName", "farmer.farmerlName"])
      .leftJoin("aqr.fromLocation", "fromLoc").addSelect(["fromLoc.name"])
      .leftJoin("aqr.product", "product").addSelect(["product.name"])
      .leftJoin("aqr.variant", "variant").addSelect(["variant.variantName"])
      .leftJoin("aqr.purchaseBy", "purchaseBy").addSelect(["purchaseBy.firstName", "purchaseBy.lastName"])
      .leftJoin("aqr.receivedBy", "receivedBy").addSelect(["receivedBy.firstName", "receivedBy.lastName"])
      .leftJoin("aqr.qcCheckBy", "qcCheckBy").addSelect(["qcCheckBy.firstName", "qcCheckBy.lastName"])
      .leftJoin("aqr.verifiedBy", "verifiedBy").addSelect(["verifiedBy.firstName", "verifiedBy.lastName"])
      .where("aqr.id IN (:...ids)", { ids: aqrIds })
      .andWhere("aqr.isDeleted = false")
      .andWhere("aqr.deletedAt IS NULL")
      .getMany();

    const aqrMap = new Map(aqrs.map((a) => [a.id, a]));



    let relatedDataOnly = activeDocs.map((doc): AqrListItemDto | null => {
      if (!doc.document_type_id) return null;
      const rd = aqrMap.get(doc.document_type_id) as any;
      if (!rd) return null;

      const selectedParty = rd.source === "vendor"
        ? rd.selectedVendor?.companyName || null
        : rd.selectedFarmer
          ? `${rd.selectedFarmer.farmerfName} ${rd.selectedFarmer.farmerlName}`.trim()
          : null;

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
        deliveryChallanNo: rd.deliveryChallanNo?.challanNo || null,
        fromLocation: rd.fromLocation?.name || null,
        product: rd.product?.name || null,
        variant: rd.variant?.variantName || null,
        arrivalDate: rd.arrivalDate || null,
        arrivedQty: rd.arrivedQty != null ? Number(rd.arrivedQty).toFixed(2) : null,
        samplingQty: rd.samplingQty != null ? Number(rd.samplingQty).toFixed(2) : null,
        totalQty: rd.totalQty != null ? Number(rd.totalQty).toFixed(2) : null,
        totalpercent: rd.totalpercent || null,
        remark: rd.remark || null,
        purchaseBy: rd.purchaseBy ? `${rd.purchaseBy.firstName} ${rd.purchaseBy.lastName}`.trim() : null,
        receivedBy: rd.receivedBy ? `${rd.receivedBy.firstName} ${rd.receivedBy.lastName}`.trim() : null,
        qcCheckBy: rd.qcCheckBy ? `${rd.qcCheckBy.firstName}  ${rd.qcCheckBy.lastName}`.trim() : null,
        verifiedBy: rd.verifiedBy ? `${rd.verifiedBy.firstName} ${rd.verifiedBy.lastName}`.trim() : null,
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

    const aqrIds = deletedDocs.map((d) => d.document_type_id).filter(Boolean);
    const aqrs = await this.aqrRepo
      .createQueryBuilder("aqr")
      .leftJoin("aqr.deliveryChallanNo", "dc").addSelect(["dc.challanNo"])
      .leftJoin("aqr.companyName", "company").addSelect(["company.id", "company.name"])
      .leftJoin("aqr.location", "location").addSelect(["location.id", "location.name"])
      .leftJoin("aqr.selectedVendor", "vendor").addSelect(["vendor.id"])
      .leftJoin("aqr.selectedFarmer", "farmer").addSelect(["farmer.id"])
      .leftJoin("aqr.fromLocation", "fromLoc").addSelect(["fromLoc.id"])
      .leftJoin("aqr.product", "product").addSelect(["product.id", "product.name", "product.productCode", "product.packingType"])
      .leftJoin("aqr.variant", "variant").addSelect(["variant.id"])
      .leftJoin("aqr.purchaseBy", "purchaseBy").addSelect(["purchaseBy.firstName"])
      .leftJoin("aqr.receivedBy", "receivedBy").addSelect(["receivedBy.firstName"])
      .leftJoin("aqr.qcCheckBy", "qcCheckBy").addSelect(["qcCheckBy.firstName"])
      .leftJoin("aqr.verifiedBy", "verifiedBy").addSelect(["verifiedBy.firstName"])
      .leftJoinAndSelect("aqr.parameters", "parameters")
      .where("aqr.id IN (:...ids)", { ids: aqrIds })
      .andWhere("aqr.isDeleted = true")
      .getMany();

    const aqrMap = new Map(aqrs.map((a) => [a.id, a]));

    let relatedDataOnly = deletedDocs.map((doc) => {
      const rd = aqrMap.get(doc.document_type_id ?? '') as any;
      if (!rd) return null;
      const selectedParty = rd.source === "vendor"
        ? rd.selectedVendor?.id || null
        : rd.selectedFarmer?.id || null;
      return {
        documentId: doc.id,
        overAllStatus: doc.status,
        createdBy: `${doc.lastActionBy?.firstName || ""} ${doc.lastActionBy?.lastName || ""}`.trim(),
        createdDate: formatDateTime(doc.createdAt).createdDate,
        createdTime: formatDateTime(doc.createdAt).createdTime,
        id: rd.id || null,
        aqrFor: rd.aqrFor || null,
        companyName: rd.companyName?.id || null,
        location: rd.location?.id || null,
        source: rd.source || null,
        selectedParty,
        deliveryChallanNo: rd.deliveryChallanNo?.challanNo || null,
        fromLocation: rd.fromLocation?.id || null,
        product: rd.product?.id || null,
        productName: rd.product?.name || null,
        productCode: rd.product?.productCode || null,
        packingType: rd.product?.packingType || null,
        variant: rd.variant?.id || null,
        arrivalDate: rd.arrivalDate || null,
        arrivedQty: rd.arrivedQty || null,
        samplingQty: rd.samplingQty || null,
        totalQty: rd.totalQty || null,
        totalpercent: rd.totalpercent || null,
        remark: rd.remark || null,
        purchaseBy: rd.purchaseBy?.firstName || null,
        receivedBy: rd.receivedBy?.firstName || null,
        qcCheckBy: rd.qcCheckBy?.firstName || null,
        verifiedBy: rd.verifiedBy?.firstName || null,
        parameters: rd.parameters?.map((param: any) => ({
          id: param.id || null,
          qualityParameterId: param.qualityParameterId || null,
          qualityParameterName: param.qualityParameterName || null,
          qualityParameterType: param.qualityParameterType || null,
          quantity: param.quantity || null,
          percentage: param.percentage || null,
        })) || [],
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

  public async getAQRByIdForView(docid: string, userId: string): Promise<GetAqrByIdForViewResponseDto | null> {
    const key = this.cacheKey("view", docid, userId);
    const cached = await this.cacheService.get<GetAqrByIdForViewResponseDto>(key);
    if (cached) return cached;

    const document = await this.docSingalApproverService.getSingleApprovalDocumentById(docid, userId);
    if (!document) return null;

    const id = document.documentTypeId;
    if (!id) return null;

    const aqr = await this.aqrRepo
      .createQueryBuilder('aqr')
      .leftJoin('aqr.deliveryChallanNo', 'deliveryChallanNo')
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
      .leftJoin('aqr.purchaseBy', 'purchaseBy')
      .leftJoin('aqr.receivedBy', 'receivedBy')
      .leftJoin('aqr.qcCheckBy', 'qcCheckBy')
      .leftJoin('aqr.verifiedBy', 'verifiedBy')
      .select([
        'aqr.id', 'aqr.aqrFor', 'aqr.source', 'aqr.arrivalDate',
        'aqr.arrivedQty', 'aqr.samplingQty', 'aqr.totalQty',
        'aqr.totalpercent', 'aqr.remark', 'aqr.createdAt',
        'deliveryChallanNo.challanNo',
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
        'product.name', 'product.productCode', 'product.packingType',
        'variant.variantName',
        'parameters.id', 'parameters.qualityParameterId', 'parameters.qualityParameterName',
        'parameters.qualityParameterType', 'parameters.quantity', 'parameters.percentage',
        'purchaseBy.firstName', 'purchaseBy.lastName',
        'receivedBy.firstName', 'receivedBy.lastName',
        'qcCheckBy.firstName', 'qcCheckBy.lastName',
        'verifiedBy.firstName', 'verifiedBy.lastName',
      ])
      .where('aqr.id = :id', { id })
      .getOne();

    if (!aqr) throw new Error('AQR not found');

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

    const response: GetAqrByIdForViewResponseDto = {
      documentId: document.documentId,
      overAllStatus: document.status,
      createdBy: document.createdBy,
      createdDate,
      createdTime,
      approvalSummary: document.approvalSummary ?? null,
      id: aqr.id,
      aqrFor: aqr.aqrFor,
      companyName: aqr.companyName?.id ?? null,
      location: aqr.location?.name ?? null,
      source: aqr.source,
      selectedParty,
      deliveryChallanNo: aqr.deliveryChallanNo?.challanNo ?? null,
      fromLocation: aqr.fromLocation?.name ?? null,
      product: aqr.product?.name ?? null,
      productCode: aqr.product?.productCode ?? null,
      packingType: aqr.product?.packingType ?? null,
      variant: aqr.variant?.variantName ?? null,
      arrivalDate: aqr.arrivalDate ?? null,
      arrivedQty: aqr.arrivedQty ?? null,
      samplingQty: aqr.samplingQty ?? null,
      totalQty: aqr.totalQty ?? null,
      totalpercent: aqr.totalpercent ?? null,
      remark: aqr.remark ?? null,
      purchaseBy: mapUser(aqr.purchaseBy),
      receivedBy: mapUser(aqr.receivedBy),
      qcCheckBy: mapUser(aqr.qcCheckBy),
      verifiedBy: mapUser(aqr.verifiedBy),
      parameters: (aqr.parameters ?? []).map((param) => ({
        id: param.id ?? null,
        qualityParameterId: param.qualityParameterId ?? null,
        qualityParameterName: param.qualityParameterName ?? null,
        qualityParameterType: param.qualityParameterType ?? null,
        quantity: param.quantity ?? null,
        percentage: param.percentage ?? null,
      })),
    };

    await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
    return response;
  }
  // ─── Update ───────────────────────────────────────────────────────────────

  public async updateAqr(id: string, data: UpdateAqrDto, updatedBy: string): Promise<any> {
    const existingAqr = await this.aqrRepo.findOne({ where: { id } });
    if (!existingAqr) return null;

    //  console.log("Data ", data);


    if (!data.arrivalDate || data.arrivalDate === "") data.arrivalDate = null;

    const oldData = { ...existingAqr };
    Object.assign(existingAqr, data);
    const updatedAqr = await this.aqrRepo.save(existingAqr);

    await this.auditLogService.logChange("AQR", id, oldData, updatedAqr, updatedBy);
    await this.invalidateAqrCache(id);

    return updatedAqr;
  }



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

  // ─── Search ───────────────────────────────────────────────────────────────



  // ─── Filter ───────────────────────────────────────────────────────────────



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

  // ─── Legacy (kept for compatibility) ─────────────────────────────────────


}



//   public async updateAqr(id: string, data: UpdateAqrDto, updatedBy: string): Promise<Aqr | null> {
//   const existingAqr = await this.aqrRepo.findOne({ where: { id } });
//   console.log("existing data.......",existingAqr);
//   if (!existingAqr) return null;

//   const oldData = { ...existingAqr };

//   // Build update payload using column names / FK column names directly
//   // so TypeORM does a simple UPDATE without touching relation cascades
//   const updatePayload: Record<string, any> = {};

//   if (data.aqrFor       !== undefined) updatePayload.aqrFor       = data.aqrFor;
//   if (data.source       !== undefined) updatePayload.source       = data.source;
//   if (data.arrivalDate  !== undefined) updatePayload.arrivalDate  = data.arrivalDate  || null;
//   if (data.arrivedQty   !== undefined) updatePayload.arrivedQty   = data.arrivedQty   ?? null;
//   if (data.samplingQty  !== undefined) updatePayload.samplingQty  = data.samplingQty  ?? null;
//   if (data.totalQty     !== undefined) updatePayload.totalQty     = data.totalQty     ?? null;
//   if (data.totalpercent !== undefined) updatePayload.totalpercent = data.totalpercent ?? null;
//   if (data.remark       !== undefined) updatePayload.remark       = data.remark       ?? null;

//   // Relations — pass { id } stub; aqrRepo.update() only writes the FK column, no cascade
//   if (data.companyName       !== undefined) updatePayload.companyName       = data.companyName       ? { id: data.companyName.id }       : null;
//   if (data.location          !== undefined) updatePayload.location          = data.location          ? { id: data.location.id }          : null;
//   if (data.deliveryChallanNo !== undefined) updatePayload.deliveryChallanNo = data.deliveryChallanNo ? { id: data.deliveryChallanNo.id } : null;
//   if (data.fromLocation      !== undefined) updatePayload.fromLocation      = data.fromLocation      ? { id: data.fromLocation.id }      : null;
//   if (data.product           !== undefined) updatePayload.product           = data.product           ? { id: data.product.id }           : null;
//   if (data.variant           !== undefined) updatePayload.variant           = data.variant           ? { id: data.variant.id }           : null;
//   if (data.purchaseBy        !== undefined) updatePayload.purchaseBy        = data.purchaseBy        ? { id: data.purchaseBy.id }        : null;
//   if (data.receivedBy        !== undefined) updatePayload.receivedBy        = data.receivedBy        ? { id: data.receivedBy.id }        : null;
//   if (data.qcCheckBy         !== undefined) updatePayload.qcCheckBy         = data.qcCheckBy         ? { id: data.qcCheckBy.id }         : null;
//   if (data.verifiedBy        !== undefined) updatePayload.verifiedBy        = data.verifiedBy        ? { id: data.verifiedBy.id }        : null;

//   // selectedParty → selectedVendor / selectedFarmer
//   if (data.selectedParty !== undefined) {
//     if (data.source === Source.VENDOR) {
//       updatePayload.selectedVendor = data.selectedParty ? { id: data.selectedParty.id } : null;
//       updatePayload.selectedFarmer = null;
//     } else if (data.source === Source.FARMER) {
//       updatePayload.selectedFarmer = data.selectedParty ? { id: data.selectedParty.id } : null;
//       updatePayload.selectedVendor = null;
//     }
//   }
//   console.log("updatedPayload",updatePayload);
//   // Use update() not save() — writes only FK columns, no cascade into related tables
//   await this.aqrRepo.update(id, updatePayload);
//   if (data.parameters !== undefined) {
//   const paramRepo = this.aqrRepo.manager.getRepository(AqrParameter);
//   await paramRepo.delete({ aqr: { id } as any });

//   if (data.parameters.length > 0) {
//     const params = data.parameters.map((p) =>
//       paramRepo.create({
//         id:                   p.id,
//         qualityParameterId:   p.qualityParameterId,
//         qualityParameterName: p.qualityParameterName,
//         qualityParameterType: p.qualityParameterType as any,
//         quantity:             p.quantity  ?? null,
//         percentage:           p.percentage ?? null,
//         aqr:                  { id } as any,
//       } as DeepPartial<AqrParameter>),
//     );
//     await paramRepo.save(params);
//   }
// }

//   const updatedAqr = await this.aqrRepo.findOne({ where: { id } });
//   await this.auditLogService.logChange("AQR", id, oldData, updatedAqr, updatedBy);
//   await this.invalidateAqrCache(id);

//   console.log("updated aqr ...............",updatedAqr)
//   return updatedAqr;
// }


// ─── Delete (schedule) ────────────────────────────────────────────────────





// public async getAllAqr(queryOptions: PaginationOptions): Promise<any> {
//   const key = this.cacheKey("all", JSON.stringify(queryOptions));
//   const cached = await this.cacheService.get<any>(key);
//   if (cached) return cached;

//   const qb = this.aqrRepo
//     .createQueryBuilder("aqr")
//     .leftJoinAndSelect("aqr.product", "product")
//     .leftJoinAndSelect("aqr.parameters", "parameters")
//      .andWhere("aqr.isDeleted = false")
//     .orderBy("aqr.createdAt", "DESC");

//   const result = await buildQuery(qb, queryOptions, "aqr");
//   const response = {
//     data: result.data.map((aqr) => {
//       const { createdDate, createdTime } = formatDateTime(aqr.createdAt);
//       return { ...aqr, createdDate, createdTime, arrivalDate: formatDateTime(aqr.arrivalDate || "") };
//     }),
//     meta: result.meta,
//   };
//   await this.cacheService.set(key, response, CACHE_TTL);
//   return response;
// }




// // ─── Get By ID For View (simple) ──────────────────────────────────────────

// public async getAqrByIdForView(id: string): Promise<any> {
//   const key = this.cacheKey("simple-view", id);
//   const cached = await this.cacheService.get<any>(key);
//   if (cached) return cached;

//   const result = await this.aqrRepo
//     .createQueryBuilder("aqr")
//     .leftJoin("aqr.deliveryChallanNo", "deliveryChallanNo")
//     .leftJoin("aqr.companyName", "companyName")
//     .leftJoin("aqr.location", "location")
//     .leftJoin("aqr.selectedVendor", "selectedVendor")
//     .leftJoin("aqr.selectedFarmer", "selectedFarmer")
//     .leftJoin("aqr.fromLocation", "fromLocation")
//     .leftJoin("aqr.product", "product")
//     .leftJoin("aqr.variant", "variant")
//     .leftJoin("aqr.verifiedBy", "verifiedBy")
//     .leftJoin("aqr.qcCheckBy", "qcCheckBy")
//     .leftJoin("aqr.receivedBy", "receivedBy")
//     .leftJoin("aqr.purchaseBy", "purchaseBy")
//     .leftJoinAndSelect("aqr.parameters", "parameters")
//     .select([
//       "aqr.id", "aqr.aqrFor", "aqr.source", "aqr.arrivalDate",
//       "aqr.arrivedQty", "aqr.samplingQty", "aqr.totalQty",
//       "aqr.totalpercent", "aqr.remark", "aqr.createdAt",
//       "deliveryChallanNo.challanNo", "companyName.name", "location.name",
//       "selectedVendor.companyName", "selectedFarmer.farmerfName",
//       "selectedFarmer.farmermName", "selectedFarmer.farmerlName",
//       "fromLocation.name", "product.name", "variant.variantName",
//       "verifiedBy.firstName", "verifiedBy.lastName",
//       "qcCheckBy.firstName", "qcCheckBy.lastName",
//       "receivedBy.firstName", "receivedBy.lastName",
//       "purchaseBy.firstName", "purchaseBy.lastName",
//     ])
//     .where("aqr.id = :id", { id })
//     .getOne();

//   if (!result) return null;

//   const { createdDate, createdTime } = formatDateTime(result.createdAt);
//   const selectedParty = result.source === "vendor"
//     ? result.selectedVendor?.companyName || null
//     : result.selectedFarmer
//       ? `${result.selectedFarmer.farmerfName} ${result.selectedFarmer.farmermName} ${result.selectedFarmer.farmerlName}`.trim()
//       : null;

//   const response = {
//     id: result.id,
//     aqrFor: result.aqrFor,
//     companyName: result.companyName?.name || null,
//     location: result.location?.name || null,
//     source: result.source,
//     selectedParty,
//     deliveryChallanNo: result.deliveryChallanNo?.challanNo || null,
//     fromLocation: result.fromLocation?.name || null,
//     product: result.product?.name || null,
//     variant: result.variant?.variantName || null,
//     arrivalDate: result.arrivalDate,
//     arrivedQty: result.arrivedQty,
//     samplingQty: result.samplingQty,
//     purchaseBy: result.purchaseBy ? `${result.purchaseBy.firstName} ${result.purchaseBy.lastName}`.trim() : null,
//     receivedBy: result.receivedBy ? `${result.receivedBy.firstName} ${result.receivedBy.lastName}`.trim() : null,
//     qcCheckBy: result.qcCheckBy ? `${result.qcCheckBy.firstName} ${result.qcCheckBy.lastName}`.trim() : null,
//     verifiedBy: result.verifiedBy ? `${result.verifiedBy.firstName} ${result.verifiedBy.lastName}`.trim() : null,
//     totalQty: result.totalQty,
//     totalpercent: result.totalpercent,
//     remark: result.remark,
//     createdDate,
//     createdTime,
//     parameters: result.parameters.map((param) => ({
//       id: param.id,
//       qualityParameterId: param.qualityParameterId,
//       qualityParameterName: param.qualityParameterName,
//       qualityParameterType: param.qualityParameterType,
//       quantity: param.quantity,
//       percentage: param.percentage,
//     })),
//   };

//   await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
//   return response;
// }



// public async searchAqr(search: string): Promise<Aqr[]> {
//   return this.aqrRepo.find({ where: [{ id: search }] });
// }



// public async getAqrById(id: string): Promise<any> {
//   const key = this.cacheKey("id", id);
//   const cached = await this.cacheService.get<any>(key);
//   if (cached) return cached;

//   const result = await this.aqrRepo
//     .createQueryBuilder("aqr")
//     .leftJoin("aqr.deliveryChallanNo", "deliveryChallanNo")
//     .leftJoin("aqr.companyName", "companyName")
//     .leftJoin("aqr.location", "location")
//     .leftJoin("aqr.selectedVendor", "selectedVendor")
//     .leftJoin("aqr.selectedFarmer", "selectedFarmer")
//     .leftJoin("aqr.fromLocation", "fromLocation")
//     .leftJoin("aqr.product", "product")
//     .leftJoin("aqr.variant", "variant")
//     .leftJoinAndSelect("aqr.parameters", "parameters")
//     .select([
//       "aqr.id", "aqr.aqrFor", "aqr.source", "aqr.arrivalDate",
//       "aqr.arrivedQty", "aqr.samplingQty", "aqr.purchaseBy",
//       "aqr.receivedBy", "aqr.qcCheckBy", "aqr.verifiedBy",
//       "aqr.totalQty", "aqr.totalpercent", "aqr.remark", "aqr.createdAt",
//       "deliveryChallanNo.id", "companyName.id", "location.id",
//       "selectedVendor.id", "selectedFarmer.id", "fromLocation.id",
//       "product.id", "variant.id",
//       "parameters.id", "parameters.qualityParameterId", "parameters.qualityParameterName",
//       "parameters.qualityParameterType", "parameters.quantity", "parameters.percentage",
//     ])
//     .where("aqr.id = :id", { id })
//     .getOne();

//   if (!result) return null;

//   const { createdDate, createdTime } = formatDateTime(result.createdAt);
//   const response = {
//     id: result.id,
//     aqrFor: result.aqrFor,
//     companyName: result.companyName?.id || null,
//     location: result.location?.id || null,
//     source: result.source,
//     selectedParty: result.source === "vendor"
//       ? result.selectedVendor?.id || null
//       : result.selectedFarmer?.id || null,
//     deliveryChallanNo: result.deliveryChallanNo?.id || null,
//     fromLocation: result.fromLocation?.id || null,
//     product: result.product?.id || null,
//     variant: result.variant?.id || null,
//     arrivalDate: result.arrivalDate,
//     arrivedQty: result.arrivedQty,
//     samplingQty: result.samplingQty,
//     purchaseBy: result.purchaseBy,
//     receivedBy: result.receivedBy,
//     qcCheckBy: result.qcCheckBy,
//     verifiedBy: result.verifiedBy,
//     totalQty: result.totalQty,
//     totalpercent: result.totalpercent,
//     remark: result.remark,
//     createdDate,
//     createdTime,
//     parameters: (result.parameters ?? []).map((param) => ({
//       id: param.id,
//       qualityParameterId: param.qualityParameterId,
//       qualityParameterName: param.qualityParameterName,
//       qualityParameterType: param.qualityParameterType,
//       quantity: param.quantity,
//       percentage: param.percentage,
//     })),
//   };

//   await this.cacheService.set(key, response, CACHE_TTL_DETAIL);
//   return response;
// }



// async filterAqrs(page: number, limit: number, filters: Record<string, any>) {
//   const key = this.cacheKey("filter", JSON.stringify({ page, limit, filters }));
//   const cached = await this.cacheService.get<any>(key);
//   if (cached) return cached;

//   const qb: SelectQueryBuilder<Aqr> = this.aqrRepo.createQueryBuilder("aqr");
//   qb.select("aqr")
//     .leftJoin("aqr.purchaseBy", "purchasedBy").addSelect(["purchasedBy.id", "purchasedBy.firstName", "purchasedBy.lastName"])
//     .leftJoin("aqr.receivedBy", "receivedBy").addSelect(["receivedBy.id", "receivedBy.firstName", "receivedBy.lastName"])
//     .leftJoin("aqr.qcCheckBy", "qcCheckedBy").addSelect(["qcCheckedBy.id", "qcCheckedBy.firstName", "qcCheckedBy.lastName"])
//     .leftJoin("aqr.verifiedBy", "verifiedBy").addSelect(["verifiedBy.id", "verifiedBy.firstName", "verifiedBy.lastName"])
//     .leftJoin("aqr.product", "product").addSelect(["product.id", "product.name"]);

//   Object.entries(filters).forEach(([key, value]) => {
//     if (key.includes(".")) {
//       const [alias, field] = key.split(".");
//       qb.andWhere(`${alias}.${field} ILIKE :${field}`, { [field]: `%${value}%` });
//     } else if (typeof value === "string" && isNaN(Number(value))) {
//       qb.andWhere(`aqr.${key} ILIKE :${key}`, { [key]: `%${value}%` });
//     } else {
//       qb.andWhere(`aqr.${key} = :${key}`, { [key]: value });
//     }
//   });

//   qb.skip((page - 1) * limit).take(limit);
//   const [data, total] = await qb.getManyAndCount();

//   const result = { data, total, page, limit, totalPages: Math.ceil(total / limit) };
//   await this.cacheService.set(key, result, CACHE_TTL);
//   return result;
// }


