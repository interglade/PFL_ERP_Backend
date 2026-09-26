import { inject, injectable } from 'inversify';


import { ILike, In, SelectQueryBuilder } from 'typeorm';

import { createHash } from 'crypto';
import { TYPES } from '../../types';
import { VehicleDispatchRepository } from '../repository/vehicleDispatch.repository';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { DocSingalApproverService } from '../../approvalFlow/service/DocSingalApproverService.service';
import { DocumentbService, DocumentWithRelatedData } from '../../approvalFlow/service/documentb.service';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';
import { ApprovalFlowService } from '../../approvalFlow/service/approvalFlow.service';
import { CacheService } from '../../global/cache.service';
import { CreateVehicleDispatchDto, UpdateVehicleDispatchDto } from '../dto/vehicleDispatch.dto';
import { VehicleDispatch } from '../entity/vehicleDispatch.entity';
import { DocumentTypeEnum, DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';
import { DocumentStatus } from '../../approvalFlow/entity/docuemnt.entity';
import { formatDateTime } from '../../utils/dateUtils';
import { buildQuery, PaginationOptions } from '../../utils/pagination';
import { BulkDeleteResultDto, DeleteResultDto } from '../../global/general.dto';
import AppError from '../../utils/appError';


@injectable()
export class VehicleDispatchService {
  constructor(
    @inject(TYPES.VehicleDispatchRepository)
    private readonly vehicleDispatchRepository: VehicleDispatchRepository,
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
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
  ) {}

  private readonly CACHE_PREFIX = 'vehicleDispatch';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:list:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:recycle:*`),
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:all:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:id:${id}`),
        // The view cache is keyed by Documentb id (+ userId), not by the vehicle
        // dispatch id, so it can only be busted by pattern from here.
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:view:*`),
      );
    }
    await Promise.all(tasks);
  }
private async generateSerialNo(): Promise<string> {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const datePrefix = `VDR${yyyy}${mm}${dd}`;

    const count = await this.vehicleDispatchRepository.count({
      where: { vehicleDispatchNo: ILike(`${datePrefix}%`) },
    });

    return `${datePrefix}${(count + 1).toString().padStart(5, '0')}`;
  }




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

  async create(data: CreateVehicleDispatchDto): Promise<VehicleDispatch> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(data.requestedBy, DocumentTypeEnum.OPERATION);

    // Check approval flow exists for logged user
    // const approvalFlowExit = await this.approvalFlowService.findApprovalFlowForLoggedUser(
    //   data.requestedBy!,
    //   DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
    // );

    // if (!approvalFlowExit) {
    //   throw new Error('Approval flow not found');
    // }

const serialNo = await this.generateSerialNo();
    const vehicleDispatch = this.vehicleDispatchRepository.create({
      ...(data as any),
      vehicleDispatchNo: serialNo,
    });
    
    const savedVehicalDispatch = await this.vehicleDispatchRepository.save(vehicleDispatch) as unknown as VehicleDispatch;

    //Todo:By Vaishali
    const document = await this.documentbService.createDocument({
      type: DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
      docDef: DocumentTypeEnum.OPERATION,
      status: DocumentStatus.HOLD,
      remarks: 'Document auto-created with Vehical_Dispatch',
      lastActionBy: { id: data.requestedBy },
      document_type_id: savedVehicalDispatch.id,
    });

    await this.documentbService.startApprovalFlow(document.id);
    
    await this.invalidateCache();
    return savedVehicalDispatch;
  }
//TODO:Get All Recycle Bin Vehical Dispatch..By Vaishali
  public async getAllRecycleBinVehicalDispatch(queryOptions: PaginationOptions, userId: string): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:recycle:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
      userId,
      DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
      true, // includeDeleted for recycle bin
    );
    const { search } = queryOptions;

    const typedDocuments = data as DocumentWithRelatedData[];
    const activeDocuments = typedDocuments;

    // ---- Batch fetch instead of N+1 ----
    const dispatchIds = activeDocuments
      .map(doc => doc.document_type_id)
      .filter(Boolean) as string[];

    const dispatches = dispatchIds.length
      ? await this.vehicleDispatchRepository
          .createQueryBuilder('vd')
          .leftJoinAndSelect('vd.companyName', 'companyName')
          .leftJoinAndSelect('vd.clientAddress', 'clientAddress')
          .leftJoinAndSelect('vd.deliveryChallanNo', 'deliveryChallanNo')
          .where('vd.id IN (:...ids)', { ids: dispatchIds })
          .andWhere('vd.isDeleted = true')
          .getMany()
      : [];

    const dispatchMap = new Map(dispatches.map(d => [d.id, d]));

    let relatedDataOnly = activeDocuments
      .filter(doc => doc.document_type_id && dispatchMap.has(doc.document_type_id))
      .map((doc) => {
        const rd: any = dispatchMap.get(doc.document_type_id!)!;
        return {
          documentId: doc.id,
          overAllStatus: doc.status,
          createdBy: `${doc.lastActionBy.firstName || null}  ${doc.lastActionBy.lastName || null}`,
          createdDate: formatDateTime(doc.createdAt).createdDate,
          createdTime: formatDateTime(doc.createdAt).createdTime,
          id: rd.id || null,
          date: rd.date || null,
          vehicleType: rd.vehicleType || null,
          vehicleNo: rd.vehicleNo || null,
          driverName: rd.driverName || null,
          driverMobNo: rd.driverMobNo || null,
          paymentDiscussed: rd.paymentDiscussed || null,
          outTime: rd.outTime || null,
          reachingTime: rd.reachingTime || null,
          clientName: rd.clientName || null,
          receivingPerson: rd.receivingPerson || null,
          supervisorName: rd.supervisorName || null,
          accDeptVerification: rd.accDeptVerification || null,
          transportationBillAmt: rd.transportationBillAmt || null,
          advancePaid: rd.advancePaid || null,
          remarksPFL: rd.remarksPFL || null,
          feedbackbyTransporterOwner: rd.feedbackbyTransporterOwner || null,
          netInwardQty: rd.netInwardQty || null,
          clientGRNNo: rd.clientGRNNo || null,
          paymentTerms: rd.paymentTerms || null,
          rejection: rd.rejection || null,
          shrinkageDump: rd.shrinkageDump || null,
          companyName: rd.companyName?.name || null,
          clientAddress: rd.clientAddress || null,
          deliveryChallanNo: rd.deliveryChallanNo?.challanNo || null,
        };
      });

    const objectToString = (obj: any): string => {
      if (obj == null) return '';
      if (typeof obj === 'object') return Object.values(obj).map((v) => objectToString(v)).join(' ');
      return String(obj);
    };

    if (search && search.trim()) {
      const term = search.toLowerCase();
      relatedDataOnly = relatedDataOnly.filter((item) =>
        objectToString(item).toLowerCase().includes(term)
      );
    }

    if (queryOptions.sort) {
      const [field, direction] = queryOptions.sort.split(':');
      const sortOrder = direction?.toUpperCase() === 'DESC' ? -1 : 1;
      const getNestedValue = (obj: any, path: string) =>
        path.split('.').reduce((o, key) => (o ? o[key] : undefined), obj);

      relatedDataOnly.sort((a, b) => {
        const valA = getNestedValue(a, field);
        const valB = getNestedValue(b, field);
        if (valA == null && valB == null) return 0;
        if (valA == null) return -1 * sortOrder;
        if (valB == null) return 1 * sortOrder;
        if (!isNaN(valA) && !isNaN(valB)) return (Number(valA) - Number(valB)) * sortOrder;
        return String(valA).localeCompare(String(valB)) * sortOrder;
      });
    }

    const result = {
      data: relatedDataOnly,
      meta: {
        total: relatedDataOnly.length,
        page: queryOptions.page || 1,
        pages: Math.ceil(relatedDataOnly.length / (queryOptions.limit || 10)),
      },
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }
  async findAll(queryOptions: PaginationOptions): Promise<any> {
    const hash = createHash('md5').update(JSON.stringify(queryOptions)).digest('hex');
    const cacheKey = `${this.CACHE_PREFIX}:all:${hash}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    let query = this.vehicleDispatchRepository
    .createQueryBuilder('dispatch')
    .leftJoinAndSelect('dispatch.clientAddress', 'clientAddress')
    .leftJoinAndSelect('dispatch.deliveryChallanNo', 'deliveryChallanNo')
    .leftJoinAndSelect('dispatch.companyName', 'companyName')
    .orderBy('dispatch.createdAt', 'DESC');

  const result = await buildQuery(query, queryOptions, 'dispatch');
  const formattedResult = result.data.map((item) => {
    return {
      id: item.id,
      companyName: item.companyName?.name || null,
      date: item.date,
      vehicleType: item.vehicleType,
      vehicleNo: item.vehicleNo,
      driverName: item.driverName,
      driverMobNo: item.driverMobNo,
      paymentDiscussed: item.paymentDiscussed,
      outTime: item.outTime,
      reachingTime: item.reachingTime,
      clientName: item.clientName,
      clientAddress: item.clientAddress ? {
        address1: item.clientAddress.address1,
        address2: item.clientAddress.address2,
        location: item.clientAddress.location,
        city: item.clientAddress.city,
        state: item.clientAddress.state,
        pincode: item.clientAddress.pincode,
      } : null,
      receivingPerson: item.receivingPerson,
      supervisorName: item.supervisorName,
      accDeptVerification: item.accDeptVerification,
      transportationBillAmt: item.transportationBillAmt,
      advancePaid: item.advancePaid,
      remarksPFL: item.remarksPFL,
      feedbackbyTransporterOwner: item.feedbackbyTransporterOwner,
      netInwardQty: item.netInwardQty,
      clientGRNNo: item.clientGRNNo,
      paymentTerms: item.paymentTerms,
      deliveryChallanNo: item.deliveryChallanNo?.challanNo || null,
      rejection: item.rejection,
      shrinkageDump: item.shrinkageDump,
    };
  });

  const finalResult = { data: formattedResult, meta: result.meta };
  await this.cacheService.set(cacheKey, finalResult, this.CACHE_TTL);
  return finalResult;
}

  

  async findById(id: string): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const vdr = await this.vehicleDispatchRepository
      .createQueryBuilder('dispatch')
      .leftJoinAndSelect('dispatch.clientAddress', 'clientAddress')
      .leftJoinAndSelect('dispatch.deliveryChallanNo', 'deliveryChallanNo')
      .leftJoinAndSelect('dispatch.companyName', 'companyName')
      .where('dispatch.id = :id', { id })
      .getOne();

    if (!vdr) return null;

    const result = {
      id: vdr.id,
      vehicleDispatchNo: vdr.vehicleDispatchNo || null,
      companyName: vdr.companyName?.id || null,
      date: vdr.date || null,
      vehicleType: vdr.vehicleType || null,
      vehicleNo: vdr.vehicleNo || null,
      driverName: vdr.driverName || null,
      driverMobNo: vdr.driverMobNo || null,
      paymentDiscussed: vdr.paymentDiscussed || null,
      outTime: vdr.outTime || null,
      reachingTime: vdr.reachingTime || null,
      clientName: vdr.clientName || null,
      clientAddress: vdr.clientAddress
        ? {
            id: vdr.clientAddress.id,
            address1: vdr.clientAddress.address1,
            address2: vdr.clientAddress.address2,
            location: vdr.clientAddress.location,
            city: vdr.clientAddress.city,
            state: vdr.clientAddress.state,
            pincode: vdr.clientAddress.pincode,
          }
        : null,
      receivingPerson: vdr.receivingPerson || null,
      supervisorName: vdr.supervisorName || null,
      accDeptVerification: vdr.accDeptVerification || null,
      transportationBillAmt: vdr.transportationBillAmt || null,
      advancePaid: vdr.advancePaid || null,
      remarksPFL: vdr.remarksPFL || null,
      feedbackbyTransporterOwner: vdr.feedbackbyTransporterOwner || null,
      netInwardQty: vdr.netInwardQty || null,
      clientGRNNo: vdr.clientGRNNo || null,
      paymentTerms: vdr.paymentTerms || null,
      deliveryChallanNo: vdr.deliveryChallanNo?.id || null,
      rejection: vdr.rejection || null,
      shrinkageDump: vdr.shrinkageDump || null,
    };
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  async update(
    id: string,
    data: UpdateVehicleDispatchDto,
    updatedBy: string,
  ): Promise<VehicleDispatch | null> {
    // Load the actual entity (not the cached plain object) so TypeORM can track changes
    const dispatch = await this.vehicleDispatchRepository.findOne({ where: { id } });
    if (!dispatch) {
      return null;
    }

    const originalDispatch = { ...dispatch };

    Object.assign(dispatch, data);

    const updatedDispatch = await this.vehicleDispatchRepository.save(dispatch);

    await this.auditLogService.logChange(
      'VehicleDispatch',
      id,
      originalDispatch,
      updatedDispatch,
      updatedBy,
    );

    await this.invalidateCache(id);
    return updatedDispatch;
  }

  async delete(id: string): Promise<DeleteResultDto | null> {
    // Step 1: Find the vehicle dispatch by ID
    const dispatch = await this.vehicleDispatchRepository.findOne({
      where: { id },
    });

    // Step 2: If the vehicle dispatch doesn't exist, return false
    if (!dispatch) {
      throw new AppError(404,`Distpatch with ID ${id} not found`);
    }

    // Step 3: Calculate the date 6 months ahead
    const now = new Date();
    const sixMonthsFromNow = new Date(now);
    sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
    sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)

   
    // Step 4: Set the deletionScheduledAt field for the vehicle dispatch
    dispatch.deletionScheduledAt = sixMonthsFromNow;

    // Step 5: Save the updated vehicle dispatch with the scheduled deletion date
    await this.vehicleDispatchRepository.save(dispatch);

    await this.invalidateCache(id);
    return {No:dispatch.vehicleDispatchNo};
  }
//Todo:Get All Vehical Dispatch..By Vaishali
  public async getAllvehicalDispatch(queryOptions: PaginationOptions, userId: string): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:list:${userId}:${JSON.stringify(queryOptions)}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
      userId,
      DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
      false,
      queryOptions,
    );
    const { search } = queryOptions;

    const typedDocuments = data as DocumentWithRelatedData[];
    const activeDocuments = typedDocuments
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // ---- Batch fetch: one query instead of N+1 ----
    const dispatchIds = activeDocuments
      .map(doc => doc.document_type_id)
      .filter(Boolean) as string[];

    const dispatches = dispatchIds.length
      ? await this.vehicleDispatchRepository
          .createQueryBuilder('vd')
          .leftJoinAndSelect('vd.companyName', 'companyName')
          .leftJoinAndSelect('vd.clientAddress', 'clientAddress')
          .leftJoinAndSelect('vd.deliveryChallanNo', 'deliveryChallanNo')
          .where('vd.id IN (:...ids)', { ids: dispatchIds })
          .andWhere('vd.isDeleted = false')
          .andWhere('vd.deletedAt IS NULL')
          .getMany()
      : [];

    const dispatchMap = new Map(dispatches.map(d => [d.id, d]));

    let relatedDataOnly = activeDocuments.map((doc) => {
      const rd: any = doc.document_type_id ? (dispatchMap.get(doc.document_type_id) || {}) : {};
      return {
        documentId: doc.id,
        overAllStatus: doc.status,
        createdBy: `${doc.lastActionBy.firstName || null}  ${doc.lastActionBy.lastName || null}`,
        createdDate: formatDateTime(doc.createdAt).createdDate,
        createdTime: formatDateTime(doc.createdAt).createdTime,
        id: rd.id || null,
        date: rd.date || null,
        vehicleType: rd.vehicleType || null,
        vehicleNo: rd.vehicleNo || null,
        driverName: rd.driverName || null,
        driverMobNo: rd.driverMobNo || null,
        paymentDiscussed: rd.paymentDiscussed || null,
        outTime: rd.outTime || null,
        reachingTime: rd.reachingTime || null,
        clientName: rd.clientName || null,
        receivingPerson: rd.receivingPerson || null,
        supervisorName: rd.supervisorName || null,
        accDeptVerification: rd.accDeptVerification || null,
        transportationBillAmt: rd.transportationBillAmt || null,
        advancePaid: rd.advancePaid || null,
        remarksPFL: rd.remarksPFL || null,
        feedbackbyTransporterOwner: rd.feedbackbyTransporterOwner || null,
        netInwardQty: rd.netInwardQty || null,
        clientGRNNo: rd.clientGRNNo || null,
        paymentTerms: rd.paymentTerms || null,
        rejection: rd.rejection || null,
        shrinkageDump: rd.shrinkageDump || null,
        companyName: rd.companyName?.name || null,
        clientAddress: rd.clientAddress || null,
        deliveryChallanNo: rd.deliveryChallanNo?.challanNo || null,
      };
    });

    // 🔍 Deep Search
    const objectToString = (obj: any): string => {
      if (obj == null) return '';
      if (typeof obj === 'object') return Object.values(obj).map((v) => objectToString(v)).join(' ');
      return String(obj);
    };

    if (search && search.trim()) {
      const term = search.toLowerCase();
      relatedDataOnly = relatedDataOnly.filter((item) =>
        objectToString(item).toLowerCase().includes(term)
      );
    }

    // 🔄 Sorting
    if (queryOptions.sort) {
      const [field, direction] = queryOptions.sort.split(':');
      const sortOrder = direction?.toUpperCase() === 'DESC' ? -1 : 1;
      const getNestedValue = (obj: any, path: string) =>
        path.split('.').reduce((o, key) => (o ? o[key] : undefined), obj);

      relatedDataOnly.sort((a, b) => {
        const valA = getNestedValue(a, field);
        const valB = getNestedValue(b, field);
        if (valA == null && valB == null) return 0;
        if (valA == null) return -1 * sortOrder;
        if (valB == null) return 1 * sortOrder;
        if (!isNaN(valA) && !isNaN(valB)) return (Number(valA) - Number(valB)) * sortOrder;
        return String(valA).localeCompare(String(valB)) * sortOrder;
      });
    }

    const result = {
      data: relatedDataOnly,
      meta: {
        total: relatedDataOnly.length,
        page: queryOptions.page || 1,
        pages: Math.ceil(relatedDataOnly.length / (queryOptions.limit || 10)),
      },
    };

    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }


  
  //Todo:Get All Vehical Dispatch..By Vaishali
  //    public async getAllvehicalDispatch(queryOptions: PaginationOptions, userId: string): Promise<
  //    any
  //   > {
  //     const data = await this.docSingalApproverService.getAllSingleApprovalDocumentsByUserId(
  //       userId,
  //       DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
  //     );
  //   const { search } = queryOptions;
  //     console.log('Fetched documents:', data);
    
  //     const typedDocuments = data as DocumentWithRelatedData[];
    
  //     if (typedDocuments.length > 0) {
  //       console.log("doc.relatedData", typedDocuments[0].relatedData);
  //     } else {
  //       console.log("No documents found for user.");
  //     }
    
  //     for (const doc of typedDocuments) {
  //       if (!doc.document_type_id) {
  //         console.log('Missing document_type_id for doc', doc.id);
  //         continue;
  //       }
    
  //       try {
  //         doc.relatedData = await this.vehicleDispatchRepository.findOne({
  //           where: { id: doc.document_type_id },
  //           relations: [
  //         'companyName',
  //         'clientAddress',
  //         'deliveryChallanNo',
  //         ]
  //         });
  //       } catch (e) {
  //         console.log("in catch block", e);
  //         doc.relatedData = null;
  //       }
  //     }
    
  //     let relatedDataOnly = typedDocuments.map((doc) => {
  //       const rd = doc.relatedData || {};
  //       return {
  //         documentId: doc.id,
  //         overAllStatus: doc.status,
  //         createdBy: `${doc.lastActionBy.firstName || null}  ${doc.lastActionBy.lastName || null}`,
  //         createdDate: formatDateTime(doc.createdAt).createdDate,
  //         createdTime: formatDateTime(doc.createdAt).createdTime,
  
  //         // From VehicleDispatch entity
  //     id: rd.id || null,
  //     date: rd.date || null,
  //     vehicleType: rd.vehicleType || null,
  //     vehicleNo: rd.vehicleNo || null,
  //     driverName: rd.driverName || null,
  //     driverMobNo: rd.driverMobNo || null,
  //     paymentDiscussed: rd.paymentDiscussed || null,
  //     outTime: rd.outTime || null,
  //     reachingTime: rd.reachingTime || null,
  //     clientName: rd.clientName || null,
  //     receivingPerson: rd.receivingPerson || null,
  //     supervisorName: rd.supervisorName || null,
  //     accDeptVerification: rd.accDeptVerification || null,
  //     transportationBillAmt: rd.transportationBillAmt || null,
  //     advancePaid: rd.advancePaid || null,
  //     remarksPFL: rd.remarksPFL || null,
  //     feedbackbyTransporterOwner: rd.feedbackbyTransporterOwner || null,
  //     netInwardQty: rd.netInwardQty || null,
  //     clientGRNNo: rd.clientGRNNo || null,
  //     paymentTerms: rd.paymentTerms || null,
  //     rejection: rd.rejection || null,
  //     shrinkageDump: rd.shrinkageDump || null,

  //     // Related entity fields
  //     companyName: rd.companyName?.name || null,
  //     clientAddress: rd.clientAddress || null,
  //     deliveryChallanNo: rd.deliveryChallanNo?.challanNo || null,

  //       };
  //     });
  //    // 🔍 Deep Search
  // const objectToString = (obj: any): string => {
  //   if (obj == null) return '';
  //   if (typeof obj === 'object') {
  //     return Object.values(obj).map((v) => objectToString(v)).join(' ');
  //   }
  //   return String(obj);
  // };

  // if (search && search.trim()) {
  //   const term = search.toLowerCase();
  //   relatedDataOnly = relatedDataOnly.filter((item) =>
  //     objectToString(item).toLowerCase().includes(term)
  //   );
  // }

  //  // 🔄 Sorting
  // if (queryOptions.sort) {
  //   const [field, direction] = queryOptions.sort.split(':');
  //   const sortOrder = direction?.toUpperCase() === 'DESC' ? -1 : 1;

  //   const getNestedValue = (obj: any, path: string) =>
  //     path.split('.').reduce((o, key) => (o ? o[key] : undefined), obj);

  //   relatedDataOnly.sort((a, b) => {
  //     const valA = getNestedValue(a, field);
  //     const valB = getNestedValue(b, field);

  //     if (valA == null && valB == null) return 0;
  //     if (valA == null) return -1 * sortOrder;
  //     if (valB == null) return 1 * sortOrder;

  //     if (!isNaN(valA) && !isNaN(valB)) {
  //       return (Number(valA) - Number(valB)) * sortOrder;
  //     }
  //     return String(valA).localeCompare(String(valB)) * sortOrder;
  //   });
  // }
  //     return {
  //       data: relatedDataOnly,
  //       meta: {
  //         total: relatedDataOnly.length,
  //         page: queryOptions.page || 1,
  //         pages: Math.ceil(relatedDataOnly.length / (queryOptions.limit || 10)),
  //       }
  //     };
  //   }

    //TODO:Get Vehical Dispatch By Id For View..By Vaishali
public async getVehicalDispatchByIdForView(docid: string, userId:string): Promise<any> {
    // Keyed by userId as well: access is checked per user (non creator/approver
    // gets null -> 403), so a shared key would serve the document to users who
    // are not allowed to see it.
    const cacheKey = `${this.CACHE_PREFIX}:view:${docid}:${userId}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const document = await this.docSingalApproverService.getSingleApprovalDocumentById(docid,userId)
    if(!document)
    {
      return null;
    }
    const id = document.documentTypeId;
    
    
    if (id) {
      //console.log("Hiiiiiiiiiiiiiiiiiiiiiii");
      //console.log('Document type ID not found for document:', id);
      
      const vehicalDispatch = await this.vehicleDispatchRepository.findOne({
        where: { id },
        relations: [
         'companyName',
        'clientAddress',
        'deliveryChallanNo',
        ],
      });

      
      

      if (!vehicalDispatch) { 
        throw new Error('AQR not found');
      }

      // let selectedPartyId: string | null = null;
      // if (grn.source === 'vendor' && grn.selectedVendor) {
      //   selectedPartyId = grn.selectedVendor.companyName;
      // } else if (grn.source === 'farmer' && grn.selectedFarmer) {
      //   selectedPartyId =
      //     grn.selectedFarmer.farmerfName +
      //     ' ' +
      //     grn.selectedFarmer.farmermName +
      //     ' ' +
      //     grn.selectedFarmer.farmerlName;
      // }
      const rawDate = vehicalDispatch.createdAt;
      const { createdDate, createdTime } = formatDateTime(rawDate);
      const result = {
    documentId: document.documentId,
    overAllStatus: document.status,
    createdBy: document.createdBy?.name || null,
    createdDate,
    createdTime,
    approvalSummary: document.approvalSummary ?? null,
// VehicleDispatch fields
      id: vehicalDispatch.id,
      date: vehicalDispatch.date || null,
      vehicleType: vehicalDispatch.vehicleType || null,
      vehicleNo: vehicalDispatch.vehicleNo || null,
      driverName: vehicalDispatch.driverName || null,
      driverMobNo: vehicalDispatch.driverMobNo || null,
      paymentDiscussed: vehicalDispatch.paymentDiscussed || null,
      outTime: vehicalDispatch.outTime || null,
      reachingTime: vehicalDispatch.reachingTime || null,
      clientName: vehicalDispatch.clientName || null,
      receivingPerson: vehicalDispatch.receivingPerson || null,
      supervisorName: vehicalDispatch.supervisorName || null,
      accDeptVerification: vehicalDispatch.accDeptVerification || null,
      transportationBillAmt: vehicalDispatch.transportationBillAmt || null,
      advancePaid: vehicalDispatch.advancePaid || null,
      remarksPFL: vehicalDispatch.remarksPFL || null,
      feedbackbyTransporterOwner: vehicalDispatch.feedbackbyTransporterOwner || null,
      netInwardQty: vehicalDispatch.netInwardQty || null,
      clientGRNNo: vehicalDispatch.clientGRNNo || null,
      paymentTerms: vehicalDispatch.paymentTerms || null,
      rejection: vehicalDispatch.rejection || null,
      shrinkageDump: vehicalDispatch.shrinkageDump || null,

      // Related entity fields
      companyName: vehicalDispatch.companyName?.name || null,
      clientAddress: [
        vehicalDispatch.clientAddress?.address1,
        vehicalDispatch.clientAddress?.address2,
        vehicalDispatch.clientAddress?.location,
        vehicalDispatch.clientAddress?.city,
        vehicalDispatch.clientAddress?.state,
        vehicalDispatch.clientAddress?.pincode,
      ].filter(Boolean).join(' ') || null,
      deliveryChallanNo: vehicalDispatch.deliveryChallanNo?.challanNo || null,
  };
  await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
  return result;
  }
}

public async deleteMultipleVehicleDispatch(ids: string[]): Promise<BulkDeleteResultDto> {
  const success:{ id: string; No: string }[] = [];
  const failed: { id: string; reason: string }[] = [];  
  for (const id of ids) {
      const vehicalDispatch = await this.vehicleDispatchRepository.findOne({
        where: { id },
      });

      if (!vehicalDispatch) {
        failed.push({ id, reason: 'Vehicle Dispatch not found' });
        continue;
      }

      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: vehicalDispatch.id }
      });

      if (!relatedDocument) {
        throw new Error(`Something went wrong`);
      }

      await this.documentbRepository.softDelete(relatedDocument.id);
      await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);

      await this.vehicleDispatchRepository.softDelete(vehicalDispatch.id);
      await this.vehicleDispatchRepository.update(vehicalDispatch.id, { isDeleted: true } as any);
      success.push({id,No:vehicalDispatch.vehicleDispatchNo})
    }
    const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
    await this.invalidateCache();
    return { success, failed, message};

  }
}


// //TODO:Filterd VehicalDispatch By Vaishali...20/08/2025
//        async filterVehicalDispatch(
//         page: number,
//         limit: number,
//         filters: Record<string, any>
//       ) {
//         const queryBuilder: SelectQueryBuilder<VehicleDispatch> =
//           this.vehicleDispatchRepository.createQueryBuilder("vehicalDispatch");
      
//         // ✅ Select all fields from Aqr
//         queryBuilder.select("vehicalDispatch");
      
//         // ✅ Join relations but select only specific fields
//         queryBuilder
//           .leftJoin("vehicalDispatch.companyName", "companyName")
//           .addSelect("companyName.name")
//           .leftJoin("vehicalDispatch.deliveryChallanNo", "deliveryChallanNo")
//           .addSelect("deliveryChallanNo.challanNo")
          
//      // ✅ Apply dynamic filters (including deep relations)
//       Object.entries(filters).forEach(([key, value], index) => {
//         const paramKey = `param_${index}`; // avoid param conflicts
    
//         const parts = key.split(".");
//         if (parts.length > 1) {
//           // Example: inwardProducts.productName.name
//           const aliasPath = parts.slice(0, -1).join(".");
//           const field = parts[parts.length - 1];
//           const alias = parts[parts.length - 2]; // e.g. productName -> alias "product"
    
//           if (typeof value === "string" && isNaN(Number(value))) {
//             queryBuilder.andWhere(`${alias}.${field} ILIKE :${paramKey}`, {
//               [paramKey]: `%${value}%`,
//             });
//           } else {
//             queryBuilder.andWhere(`${alias}.${field} = :${paramKey}`, {
//               [paramKey]: value,
//             });
//           }
//         } else {
//           // Normal InwardRegister field filter
//           if (typeof value === "string" && isNaN(Number(value))) {
//             queryBuilder.andWhere(`vehicalDispatch.${key} ILIKE :${paramKey}`, {
//               [paramKey]: `%${value}%`,
//             });
//           } else {
//             queryBuilder.andWhere(`vehicalDispatch.${key} = :${paramKey}`, {
//               [paramKey]: value,
//             });
//           }
//         }
//       });
      
//         // ✅ Pagination
//         queryBuilder.skip((page - 1) * limit).take(limit);
      
//         const [data, total] = await queryBuilder.getManyAndCount();
      
//         return {
//           data,
//           total,
//           page,
//           limit,
//           totalPages: Math.ceil(total / limit),
//         };
//       }

