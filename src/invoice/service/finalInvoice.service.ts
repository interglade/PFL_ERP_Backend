import { inject, injectable } from 'inversify';

import { DataSource } from 'typeorm';

import { Repository, Brackets } from 'typeorm';

import { toWords } from 'number-to-words';

import { createHash } from 'crypto';
import { CreateInvoiceDto, InvoiceDetailDto, InvoiceListItemDto } from '../dto/invoice.dto';
import { TYPES } from '../../types';
import { Invoice } from '../entity/invoice.entity';
import { InvoiceProduct } from '../entity/invoiceProduct.entity';
import { CustomerDeliveryChallanRepository } from '../../deliveryChallans/customerDeliveryChllan/repository/customerDeliveryChallan.repository';
import { DocumentbService } from '../../approvalFlow/service/documentb.service';
import { DocDoubleApproverService } from '../../approvalFlow/service/docDoubleApprover.service';
import { DocumentbRepository } from '../../approvalFlow/repository/documentb.repository';
import { CacheService } from '../../global/cache.service';
import AppError from '../../utils/appError';
import { Documentb, DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';
import { applyDocumentFilters, safeSqlSort } from '../../global/filters/documentFilter.query';
import { ApprovalFlowService } from '../../approvalFlow/service/approvalFlow.service';
import { formatDateTime } from '../../utils/dateUtils';
import logger from '../../utils/logger';
import { PaginationOptions } from '../../utils/pagination';
import { BulkDeleteResultDto } from '../../global/general.dto';
import { ammountStatus } from '../../utils/status.enum';

@injectable()
export class FinalInvoiceService {
  private invoiceRepository: Repository<Invoice>;
  private invoiceProductRepository: Repository<InvoiceProduct>;

  constructor(
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
    @inject(TYPES.CustomerDeliveryChallanRepository)
    private challanRepository: CustomerDeliveryChallanRepository,
    @inject(TYPES.DocumentbService)
    private documentService: DocumentbService,
    @inject(TYPES.DocDoubleApproverService)
    private docDoubleApproverService: DocDoubleApproverService,
     @inject(TYPES.DocumentbRepository)
    private readonly documentbRepository: DocumentbRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
    @inject(TYPES.ApprovalFlowService)
    private readonly approvalFlowService: ApprovalFlowService,
  ) {
    this.invoiceRepository = this.dataSource.getRepository(Invoice);
    this.invoiceProductRepository = this.dataSource.getRepository(InvoiceProduct);
  }

  private readonly CACHE_PREFIX = 'finv';
  private readonly CACHE_TTL = 180;

  private async invalidateCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:all:*`),
    ];
    if (id) {
      tasks.push(
        this.cacheService.del(`${this.CACHE_PREFIX}:update:${id}`),
        // The view cache is keyed by the Documentb id (the /view/:docid route
        // param), not by this record's own id, so it can only be busted by
        // pattern from here.
        this.cacheService.invalidatePattern(`${this.CACHE_PREFIX}:view:*`),
        this.cacheService.del(`${this.CACHE_PREFIX}:pdf:${id}`),
      );
    }
    await Promise.all(tasks);
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

  async create(deliveryChallanId: string, additionalData: CreateInvoiceDto, requestedBy: any): Promise<any> {
    // Check if approval flow exists for the user
    await this.checkApprovalFlowExists(requestedBy, DocDefEnum.SALE);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      //console.log("requested by id in the create service",requestedBy)
      // Fetch delivery challan with all related data
      const deliveryChallan = await queryRunner.manager.findOne(this.challanRepository.target, {
        where: { id: deliveryChallanId },
        relations: [
          'deliveryChallanProducts',
          'deliveryChallanProducts.productName',
          'deliveryChallanProducts.variant',
          'deliveryChallanProducts.saleUoM',
          'customerName',
          'fromLocation',
          'companyName',
          'billingAddress',
          'deliveryAddress',
        ],
      });

      if (!deliveryChallan) {
        throw new AppError(404, `Delivery Challan with id ${deliveryChallanId} not found`);
      }

      // Check if invoice already created for this delivery challan
      if (deliveryChallan.isInvoiceCreated) {
        throw new AppError(400, `Invoice has already been created for this delivery challan`);
      }

      // Generate invoice number
      const companyName = deliveryChallan.companyName?.name || 'Company';
      const locationPrefix = deliveryChallan.fromLocation?.name || 'LOC';
      const invoiceNo = await this.generateInvoiceNo(companyName, locationPrefix);

      // ── Per-product calculations based on accepted qty ──────────────────────
      // acceptedQty = originalQty - returnedQty - rejectedQty
      // (already written to dItem by updateDeliveryChallanItemsWithReturns)
      // If no return was created, acceptedQty will be null → fall back to originalQty.
      const invoiceProductData = (deliveryChallan.deliveryChallanProducts ?? []).map((dcProduct) => {
        const originalQty   = Number(dcProduct.quantity   ?? 0);
        const returnedQty   = Number(dcProduct.returnedQty ?? 0);
        const rejectedQty   = Number(dcProduct.rejectedQty ?? 0);
        const acceptedQty   = dcProduct.acceptedQty != null
          ? Number(dcProduct.acceptedQty)
          : originalQty - returnedQty - rejectedQty;

        const unitPrice     = Number(dcProduct.unitPrice  ?? 0);
        const acceptedAmt   = parseFloat((acceptedQty * unitPrice).toFixed(4));

        // Weight proportional to accepted / original qty
        const ratio         = originalQty > 0 ? acceptedQty / originalQty : 1;
        const acceptedGross = parseFloat((Number(dcProduct.grossWeight ?? 0) * ratio).toFixed(4));
        const acceptedNet   = parseFloat((Number(dcProduct.netWeight   ?? 0) * ratio).toFixed(4));

        return {
          productName:  dcProduct.productName,
          variant:      dcProduct.variant,
          saleUoM:      dcProduct.saleUoM,
          quantity:     originalQty,
          acceptedQty,
          returnedQty,
          rejectedQty,
          unitPrice,
          amount:       acceptedAmt,
          grossWeight:  acceptedGross,
          netWeight:    acceptedNet,
          //hsnCode:      additionalData.hsnCode || '',
          description:  dcProduct.productName?.description || '',
        };
      });

      // ── Invoice header totals ─────────────────────────────────────────────
      const totalProductAmount = parseFloat(
        invoiceProductData.reduce((sum, p) => sum + p.amount, 0).toFixed(4)
      );
      const netProductWeight = parseFloat(
        invoiceProductData.reduce((sum, p) => sum + p.netWeight, 0).toFixed(4)
      );

      const cgst         = Number(additionalData.cgst         ?? 0);
      const sgst         = Number(additionalData.sgst         ?? 0);
      const igst         = Number(additionalData.igst         ?? 0);
      const taxAmount    = Number(additionalData.taxAmount    ?? cgst + sgst + igst);
      const discount     = Number(additionalData.discount     ?? 0);
      const freight      = Number(additionalData.freight      ?? 0);
      const otherCharges = Number(additionalData.otherCharges ?? 0);

      const totalAmount  = parseFloat(
        (totalProductAmount + taxAmount + freight + otherCharges - discount).toFixed(4)
      );

      const totalAmtInWords = toWords(Math.round(totalAmount))
        .replace(/\b\w/g, (c: string) => c.toUpperCase()) + ' Only';

      // ── Build invoice header ──────────────────────────────────────────────
      const invoiceData = {
        invoiceNo,
        invoiceDate:        additionalData.invoiceDate || new Date(),
        companyName:        deliveryChallan.companyName,
        deliveryChallan:    { id: deliveryChallanId },
        customerName:       deliveryChallan.customerName,
        poNumber:           deliveryChallan.poNumber,
        fromLocation:       deliveryChallan.fromLocation,
        billingAddress:     deliveryChallan.billingAddress,
        deliveryAddress:    deliveryChallan.deliveryAddress,
        vehicleNo:          deliveryChallan.vehicleNo,
        placeOfSupply:      additionalData.placeOfSupply || deliveryChallan.deliveryAddress?.state,
        totalProductAmount,
        netProductWeight,
        totalAmount,
        totalAmtInWords,
        cgst,
        sgst,
        igst,
        taxAmount,
        discount,
        freight,
        otherCharges,
        createdBy: { id: requestedBy },
      };

      const invoice = queryRunner.manager.create(Invoice, invoiceData);
      const savedInvoice = await queryRunner.manager.save(invoice);

      // Create invoice products with recalculated values
      if (invoiceProductData.length > 0) {
        const invoiceProducts = invoiceProductData.map((p) => {
          const invoiceProduct = queryRunner.manager.create(InvoiceProduct, p);
          invoiceProduct.invoice = savedInvoice;
          return invoiceProduct;
        });
        await queryRunner.manager.save(InvoiceProduct, invoiceProducts);
      }

      // Mark delivery challan as invoice created
      deliveryChallan.isInvoiceCreated = true;
      await queryRunner.manager.save(deliveryChallan);

      //console.log("Creating document for final invoice...");
      // Create document
      const document = await this.documentService.createDocument({
        type: DocumentTypeEnum.FINAL_INVOICE,
        docDef: DocDefEnum.SALE,
        status: DocumentStatus.HOLD,
        remarks: 'Document auto-created with Final Invoice',
        lastActionBy: { id: requestedBy },
        document_type_id: savedInvoice.id,
      });

      // console.log("Document created with ID:", document.id);
      // console.log("Starting approval flow for final invoice...");
      await queryRunner.commitTransaction();

      // Start approval flow after commit so invoice is visible to other DB connections
      await this.documentService.startApprovalFlow(document.id);

      await this.invalidateCache();
      // Fetch the complete invoice with relations
      const completeInvoice = await this.invoiceRepository.findOne({
        where: { id: savedInvoice.id },
        relations: [
          'invoiceProducts',
          'companyName',
          'deliveryChallan',
          'customerName',
          'fromLocation',
          'billingAddress',
          'deliveryAddress',
        ],
      });
      console.log("invoice generated",completeInvoice);
      return completeInvoice;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      //console.error('Error creating Final Invoice:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new Error('Failed to create Final Invoice');
    } finally {
      await queryRunner.release();
    }
  }

  private async generateInvoiceNo(companyName: string, locationPrefix: string): Promise<string> {
    // Get the last invoice for this company and location
    const lastInvoice = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.companyName', 'company')
      .leftJoinAndSelect('invoice.fromLocation', 'location')
      .where('company.name = :companyName', { companyName })
      .andWhere('location.name = :locationPrefix', { locationPrefix })
      .orderBy('invoice.createdAt', 'DESC')
      .getOne();

    let lastSerialNumber = 0;
    
    if (lastInvoice && lastInvoice.invoiceNo) {
      // Extract serial number from invoice format: INITIALS-YEAR-LOCATION-SERIAL
      const parts = lastInvoice.invoiceNo.split('-');
      if (parts.length === 4) {
        lastSerialNumber = parseInt(parts[3]) || 0;
      }
    }

    // Extract first letter of each word to create company initials
    const companyInitials = companyName
      .split(/\s+/) // Split by whitespace
      .map(word => word.trim())
      .filter(word => word.length > 0 && /[a-zA-Z]/.test(word[0])) // Only words starting with letters
      .map(word => word[0].toUpperCase()) // Take first letter and uppercase
      .join('');
    const year = new Date().getFullYear();
    const serialNumber = (lastSerialNumber + 1).toString().padStart(5, '0');
    
    return `${companyInitials}-${year}-${locationPrefix}-${serialNumber}`;
  }

  public async getByIdForUpdate(id: string): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}:update:${id}`;
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) return cached;

    const invoice = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.invoiceProducts', 'products')
      .leftJoinAndSelect('invoice.companyName', 'companyName')
      .leftJoinAndSelect('invoice.deliveryChallan', 'deliveryChallan')
      .leftJoinAndSelect('invoice.customerName', 'customerName')
      .leftJoinAndSelect('invoice.fromLocation', 'fromLocation')
      .leftJoinAndSelect('invoice.billingAddress', 'billingAddress')
      .leftJoinAndSelect('invoice.deliveryAddress', 'deliveryAddress')
      .leftJoinAndSelect('products.productName', 'productName')
      .leftJoinAndSelect('products.variant', 'variant')
      .leftJoinAndSelect('products.saleUoM', 'saleUoM')
      .where('invoice.id = :id', { id })
      .getOne();

    if (!invoice) {
      throw new AppError(400, `Invoice with id ${id} not found`);
    }

    const { createdDate, createdTime } = formatDateTime(invoice.createdAt);

    const formattedInvoice = {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate,
      companyName: invoice.companyName?.id || null,
      deliveryChallan: invoice.deliveryChallan?.id || null,
      customerName: invoice.customerName?.id || null,
      poNumber: invoice.poNumber,
      fromLocation: invoice.fromLocation?.id || null,
      billingAddress: invoice.billingAddress
        ? {
            id: invoice.billingAddress.id,
            address1: invoice.billingAddress.address1,
            address2: invoice.billingAddress.address2,
            location: invoice.billingAddress.location,
            city: invoice.billingAddress.city,
            state: invoice.billingAddress.state,
            pincode: invoice.billingAddress.pincode,
          }
        : null,
      deliveryAddress: invoice.deliveryAddress
        ? {
            id: invoice.deliveryAddress.id,
            address1: invoice.deliveryAddress.address1,
            address2: invoice.deliveryAddress.address2,
            location: invoice.deliveryAddress.location,
            city: invoice.deliveryAddress.city,
            state: invoice.deliveryAddress.state,
            pincode: invoice.deliveryAddress.pincode,
          }
        : null,
      vehicleNo: invoice.vehicleNo,
      placeOfSupply: invoice.placeOfSupply,
      totalProductAmount: invoice.totalProductAmount,
      netProductWeight: invoice.netProductWeight,
      totalAmount: invoice.totalAmount,
      totalAmtInWords: invoice.totalAmtInWords,
      cgst: invoice.cgst,
      sgst: invoice.sgst,
      igst: invoice.igst,
      taxAmount: invoice.taxAmount,
      discount: invoice.discount,
      freight: invoice.freight,
      otherCharges: invoice.otherCharges,
      createdDate,
      createdTime,
      invoiceProducts: invoice.invoiceProducts?.map((product) => ({
        id: product.id,
        productName: product.productName?.id || null,
        variant: product.variant?.id || null,
        quantity: product.quantity,
        acceptedQty: product.acceptedQty,
        rejectedQty: product.rejectedQty,
        returnedQty: product.returnedQty,
        saleUoM: product.saleUoM?.id || null,
        amount: product.amount,
        unitPrice: product.unitPrice,
        grossWeight: product.grossWeight,
        netWeight: product.netWeight,
        hsnCode: product.hsnCode,
        description: product.description,
      })) || [],
    };

    await this.cacheService.set(cacheKey, { data: formattedInvoice }, this.CACHE_TTL);
    return { data: formattedInvoice };
  }

  public async getByIdForView(id: string): Promise<InvoiceDetailDto> {
    const cacheKey = `${this.CACHE_PREFIX}:view:${id}`;
    const cached = await this.cacheService.get<InvoiceDetailDto>(cacheKey);
    if (cached) return cached;

    const document = await this.docDoubleApproverService.getDocumentById(id);
    const invoiceId = document.documentTypeId;
    if (!invoiceId) throw new AppError(400, `Invoice with document ID ${id} not found`);

    const invoice = await this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoin('invoice.invoiceProducts', 'products')
      .leftJoin('products.productName', 'productName')
      .leftJoin('products.variant', 'variant')
      .leftJoin('products.saleUoM', 'saleUoM')
      .leftJoin('invoice.companyName', 'company')
      .leftJoin('company.bankDetails', 'bankDetails')
      .leftJoin('invoice.deliveryChallan', 'deliveryChallan')
      .leftJoin('invoice.customerName', 'customer')
      .leftJoin('customer.statutoryDetails', 'statutory')
      .leftJoin('invoice.fromLocation', 'fromLocation')
      .leftJoin('invoice.billingAddress', 'billingAddress')
      .leftJoin('invoice.deliveryAddress', 'deliveryAddress')
      .leftJoin('invoice.createdBy', 'createdBy')
      .select([
        'invoice.id', 'invoice.invoiceNo', 'invoice.invoiceDate', 'invoice.vehicleNo',
        'invoice.poNumber', 'invoice.placeOfSupply', 'invoice.totalProductAmount',
        'invoice.netProductWeight', 'invoice.totalAmount', 'invoice.totalAmtInWords',
        'invoice.cgst', 'invoice.sgst', 'invoice.igst', 'invoice.taxAmount',
        'invoice.discount', 'invoice.freight', 'invoice.otherCharges', 'invoice.createdAt',
        'company.id', 'company.name', 'company.officeAddress', 'company.gstNo', 'company.fassaiNo',
        'bankDetails.bankName', 'bankDetails.accountNo', 'bankDetails.branch', 'bankDetails.ifscCode',
        'deliveryChallan.challanNo','invoice.ammountStatus',
        'customer.id', 'customer.organisationName', 'customer.customerCode',
        'customer.primaryContactNo', 'customer.secondaryContactNo',
        'statutory.gstn', 'statutory.panNo',
        'fromLocation.name',
        'billingAddress.id', 'billingAddress.address1', 'billingAddress.address2',
        'billingAddress.location', 'billingAddress.city', 'billingAddress.state', 'billingAddress.pincode',
        'deliveryAddress.id', 'deliveryAddress.address1', 'deliveryAddress.address2',
        'deliveryAddress.location', 'deliveryAddress.city', 'deliveryAddress.state', 'deliveryAddress.pincode',
        'createdBy.firstName', 'createdBy.lastName',
        'products.id', 'products.quantity', 'products.acceptedQty', 'products.rejectedQty',
        'products.returnedQty', 'products.amount', 'products.unitPrice',
        'products.grossWeight', 'products.netWeight', 'products.hsnCode', 'products.description',
        'productName.name', 'variant.variantName', 'saleUoM.unit',
      ])
      .where('invoice.id = :id', { id: invoiceId })
      .getOne();

    if (!invoice) throw new AppError(400, `Invoice with ID ${invoiceId} not found`);

    const { createdDate, createdTime } = formatDateTime(invoice.createdAt);
    const mapAddress = (addr: any) => addr ? {
      id: addr.id, address1: addr.address1, address2: addr.address2,
      location: addr.location, city: addr.city, state: addr.state, pincode: addr.pincode,
    } : null;

    const companyBankDetails = invoice.companyName?.bankDetails?.[0] ?? null;

    const result = {
      ammountStatus:invoice.ammountStatus,
      id: invoice.id,
      documentId: document.id,
      overAllStatus: document.overAllStatus,
      approvalSummary: document.approvalSummary ?? null,
      invoiceNo: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate,
      createdDate,
      createdTime,
      createdBy: invoice.createdBy
        ? `${invoice.createdBy.firstName} ${invoice.createdBy.lastName}`
        : null,
      companyName: {
        id: invoice.companyName?.id ?? null,
        name: invoice.companyName?.name ?? null,
        officeAddress: invoice.companyName?.officeAddress ?? null,
        gstNo: invoice.companyName?.gstNo ?? null,
        fassaiNo: invoice.companyName?.fassaiNo ?? null,
        bankDetails: companyBankDetails ? {
          bankName: companyBankDetails.bankName ?? null,
          accountNo: companyBankDetails.accountNo ?? null,
          branch: companyBankDetails.branch ?? null,
          ifscCode: companyBankDetails.ifscCode ?? null,
        } : null,
      },
      customer: {
        id: invoice.customerName?.id ?? null,
        customerName: invoice.customerName?.organisationName ?? null,
        customerCode: invoice.customerName?.customerCode ?? null,
        contactNo: invoice.customerName?.primaryContactNo ?? invoice.customerName?.secondaryContactNo ?? null,
        gstn: invoice.customerName?.statutoryDetails?.gstn ?? null,
        panNo: invoice.customerName?.statutoryDetails?.panNo ?? null,
      },
      deliveryChallan: invoice.deliveryChallan?.challanNo ?? null,
      poNumber: invoice.poNumber,
      fromLocation: invoice.fromLocation?.name ?? null,
      billingAddress: mapAddress(invoice.billingAddress),
      deliveryAddress: mapAddress(invoice.deliveryAddress),
      vehicleNo: invoice.vehicleNo,
      placeOfSupply: invoice.placeOfSupply,
      totalProductAmount: invoice.totalProductAmount,
      netProductWeight: invoice.netProductWeight,
      totalAmount: invoice.totalAmount,
      totalAmtInWords: invoice.totalAmtInWords,
      cgst: invoice.cgst,
      sgst: invoice.sgst,
      igst: invoice.igst,
      taxAmount: invoice.taxAmount,
      discount: invoice.discount,
      freight: invoice.freight,
      otherCharges: invoice.otherCharges,
      invoiceProducts: (invoice.invoiceProducts ?? []).map((p) => ({
        id: p.id,
        productName: p.productName?.name ?? null,
        variant: p.variant?.variantName ?? null,
        quantity: p.quantity,
        acceptedQty: p.acceptedQty != null
          ? p.acceptedQty
          : (p.quantity || 0) - (p.returnedQty || 0) - (p.rejectedQty || 0),
        rejectedQty: p.rejectedQty,
        returnedQty: p.returnedQty,
        saleUoM: p.saleUoM?.unit ?? null,
        amount: p.amount,
        unitPrice: p.unitPrice,
        grossWeight: p.grossWeight,
        netWeight: p.netWeight,
        hsnCode: p.hsnCode,
        description: p.description,
      })),
    };

    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }

  public async getAll(
    queryOptions: PaginationOptions,
    userId: string,
  ): Promise<{ data: InvoiceListItemDto[]; meta: { total: number; page: number; pages: number } }> {
    const cacheKey = `${this.CACHE_PREFIX}:all:${userId}:${createHash('md5').update(JSON.stringify(queryOptions)).digest('hex')}`;
    console.log("in invoice service — cache key:", cacheKey);
    const cached = await this.cacheService.get<any>(cacheKey);
    if (cached) {
      console.log("in invoice service — returning cached result");
      return cached;
    }

    const { search, sort, page = 1, limit = 10 } = queryOptions;
    // Single joined query — invoice + document in one shot
    const qb = this.invoiceRepository
      .createQueryBuilder('invoice')
      .innerJoin(Documentb, 'doc', 'doc.document_type_id = invoice.id::text AND doc.type = :docType AND doc.isDeleted = false AND doc.deletedAt IS NULL', { docType: DocumentTypeEnum.FINAL_INVOICE })
      .innerJoin('doc.approvalFlow', 'approvalFlow')
      .innerJoin('approvalFlow.approvers', 'approvalLevel')
      .leftJoin('approvalLevel.firstApprover', 'firstApproverBlock')
      .leftJoin('firstApproverBlock.users', 'firstApproverUser')
      .leftJoin('approvalLevel.secondApprover', 'secondApproverBlock')
      .leftJoin('secondApproverBlock.users', 'secondApproverUser')
      .leftJoin('doc.lastActionBy', 'lastActionBy')
      .leftJoin('invoice.companyName', 'company')
      .leftJoin('invoice.deliveryChallan', 'deliveryChallan')
      .leftJoin('invoice.customerName', 'customerName')
      .leftJoin('invoice.fromLocation', 'fromLocation')
      .leftJoin('invoice.billingAddress', 'billingAddress')
      .leftJoin('invoice.deliveryAddress', 'deliveryAddress')
      .select([
        'invoice.id', 'invoice.invoiceNo', 'invoice.invoiceDate', 'invoice.vehicleNo',
        'invoice.poNumber', 'invoice.totalProductAmount', 'invoice.netProductWeight',
        'invoice.totalAmount', 'invoice.ammountStatus', 'invoice.createdAt',
        'company.name', 'deliveryChallan.challanNo',
        'customerName.organisationName', 'fromLocation.name',
        'billingAddress.address1', 'billingAddress.address2', 'billingAddress.location',
        'billingAddress.city', 'billingAddress.state', 'billingAddress.pincode',
        'deliveryAddress.address1', 'deliveryAddress.address2', 'deliveryAddress.location',
        'deliveryAddress.city', 'deliveryAddress.state', 'deliveryAddress.pincode',
      ])
      .addSelect(
        '(SELECT COALESCE(SUM(ip."grossWeight"), 0) FROM invoice_products ip WHERE ip.invoice_id = invoice.id)',
        'grossProductWeight',
      )
      .addSelect('doc.id', 'docId')
      .addSelect('doc.status', 'docStatus')
      .addSelect('doc.createdAt', 'docCreatedAt')
      .addSelect('lastActionBy.id', 'lastActionById')
      .addSelect('lastActionBy.firstName', 'lastActionByFirstName')
      .addSelect('lastActionBy.lastName', 'lastActionByLastName')
      .where('invoice.isDeleted = false')
      .andWhere('invoice.deletedAt IS NULL')
      .andWhere(
        new Brackets((qb) => {
          qb.orWhere('firstApproverUser.id = :userId', { userId })
            .orWhere('secondApproverUser.id = :userId', { userId })
            .orWhere('lastActionBy.id = :userId', { userId });
        }),
      );

    if (search && search.trim()) {
      const term = `%${search.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((qb) => {
          qb.orWhere('LOWER(invoice.invoiceNo) LIKE :term', { term })
            .orWhere('LOWER(company.name) LIKE :term', { term })
            .orWhere('LOWER(customerName.organisationName) LIKE :term', { term })
            .orWhere('LOWER(deliveryChallan.challanNo) LIKE :term', { term })
            .orWhere('LOWER(invoice.vehicleNo) LIKE :term', { term })
            .orWhere('LOWER(invoice.poNumber) LIKE :term', { term })
            .orWhere('LOWER(fromLocation.name) LIKE :term', { term });
        }),
      );
    }

    // Document filters run here, in SQL, inside the visibility rules above and before
    // pagination - the same filters every other document list uses.
    const sorted = applyDocumentFilters(qb, queryOptions.documentFilters, { documentAlias: 'doc', recordAlias: 'invoice' });
    if (!sorted) {
      // A raw sort string is only honoured as a plain column on the invoice or document.
      const [sortField, sortOrder] = safeSqlSort(sort, ['invoice', 'doc'], ['invoice.createdAt', 'DESC']);
      qb.orderBy(sortField, sortOrder);
    }

    const total = await qb.getCount();
    const raw = await qb.offset((page - 1) * limit).limit(limit).getRawAndEntities();

    const formatAddr = (addr: any) => addr
      ? [addr.address1, addr.address2, addr.location, addr.city, addr.state, addr.pincode]
          .filter(Boolean).join(' ')
      : null;


    const data: InvoiceListItemDto[] = raw.entities.map((invoice, i) => {
      const r = raw.raw[i];
      const { createdDate, createdTime } = formatDateTime(r.docCreatedAt ?? invoice.createdAt);
      const firstName = r.lastActionByFirstName ?? '';
      const lastName = r.lastActionByLastName ?? '';
      return {
        ammountStatus:invoice.ammountStatus,
        documentId: r.docId,
        overAllStatus: r.docStatus,
        createdBy: `${firstName} ${lastName}`.trim(),
        createdDate,
        createdTime,
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        invoiceDate: invoice.invoiceDate,
        vehicleNo: invoice.vehicleNo ?? null,
        companyName: (invoice as any).companyName?.name ?? null,
        deliveryChallan: (invoice as any).deliveryChallan?.challanNo ?? null,
        customerName: (invoice as any).customerName?.organisationName ?? null,
        poNumber: invoice.poNumber,
        fromLocation: (invoice as any).fromLocation?.name ?? null,
        totalProductAmount: invoice.totalProductAmount,
        netProductWeight: invoice.netProductWeight,
        grossProductWeight: r.grossProductWeight !== null && r.grossProductWeight !== undefined
          ? Number(r.grossProductWeight)
          : null,
        totalAmount: invoice.totalAmount,
        billingAddress: formatAddr((invoice as any).billingAddress),
        deliveryAddress: formatAddr((invoice as any).deliveryAddress),
      };
    });

    //console.log(data)
    const result = {
      data,
      meta: { total, page, pages: Math.ceil(total / limit) },
    };
    console.log("dattttttttaaaaaaaaaaaaa",data);
    await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
    return result;
  }



  public async getByIdForPdf(id: string): Promise<any> {
      const cacheKey = `${this.CACHE_PREFIX}:pdf:${id}`;
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) return cached;

      try {
        const invoice = await this.invoiceRepository.findOne({
          where: { id },
          relations: [
            'invoiceProducts',
            'invoiceProducts.productName',
            'invoiceProducts.variant',
            'invoiceProducts.saleUoM',
            'companyName',
            'companyName.bankDetails',
            'deliveryChallan',
            'customerName',
            'customerName.billingDetails',
            'customerName.deliveryDetails',
            'customerName.statutoryDetails',
            'fromLocation',
            'fromLocation.address',
            'billingAddress',
            'deliveryAddress',
            'createdBy',
          ],
        });

        if (!invoice) {
          throw new AppError(404, 'Invoice not found');
        }

        // Get company details
        const company = invoice.companyName;

        // Get customer details
        const customer = invoice.customerName;

        // Get billing address (from invoice or customer)
        const billToAddress = invoice.billingAddress
          ? {
              address1: invoice.billingAddress.address1 || '',
              address2: invoice.billingAddress.address2 || '',
              location: invoice.billingAddress.location || '',
              city: invoice.billingAddress.city || '',
              state: invoice.billingAddress.state || '',
              pincode: invoice.billingAddress.pincode || '',
            }
          : customer?.billingDetails?.billingAddress
          ? {
              address1: customer.billingDetails.billingAddress?.address1 || '',
              address2: customer.billingDetails.billingAddress?.address2 || '',
              location: customer.billingDetails.billingAddress?.location || '',
              city: customer.billingDetails.billingAddress?.city || '',
              state: customer.billingDetails.billingAddress?.state || '',
              pincode: customer.billingDetails.billingAddress?.pincode || '',
            }
          : null;

        // Get delivery/shipping address (from invoice or customer)
        const shipToAddress = invoice.deliveryAddress
          ? {
              address1: invoice.deliveryAddress.address1 || '',
              address2: invoice.deliveryAddress.address2 || '',
              location: invoice.deliveryAddress.location || '',
              city: invoice.deliveryAddress.city || '',
              state: invoice.deliveryAddress.state || '',
              pincode: invoice.deliveryAddress.pincode || '',
            }
          : customer?.deliveryDetails?.deliveryAddress
          ? {
              address1: customer.deliveryDetails.deliveryAddress?.address1 || '',
              address2: customer.deliveryDetails.deliveryAddress?.address2 || '',
              location: customer.deliveryDetails.deliveryAddress?.location || '',
              city: customer.deliveryDetails.deliveryAddress?.city || '',
              state: customer.deliveryDetails.deliveryAddress?.state || '',
              pincode: customer.deliveryDetails.deliveryAddress?.pincode || '',
            }
          : null;

        // Get bank details from customer or company
        const customerBankDetails = customer?.bankDetails;
        const companyBankDetails = company?.bankDetails && company.bankDetails.length > 0 ? company.bankDetails[0] : null;
        const bankDetails = (customerBankDetails || companyBankDetails || {}) as any;
        
        // Map bank details properties correctly based on entity type
        const mappedBankDetails = {
          bankName: bankDetails?.bankName || '',
          accountNo: bankDetails?.accountNo || '',
          ifsc: bankDetails?.ifscCode || bankDetails?.ifsc || '',
          branch: bankDetails?.bankBranch || bankDetails?.branch || '',
        };
        
        // Get delivery challan to calculate acceptedQty with returns
        const deliveryChallan = invoice.deliveryChallan;
        
        // Format invoice products with acceptedQty = qty - returnedQty (if returns exist)
        const items = invoice.invoiceProducts?.map((product) => {
          // If returnedQty exists and is > 0, calculate acceptedQty = qty - returnedQty
          // Otherwise, use the original qty
          const returnedQty = product.returnedQty || 0;
          const acceptedQty = returnedQty > 0 ? (product.quantity || 0) - returnedQty : (product.quantity || 0);
          // Calculate amount based on acceptedQty
          const amt = acceptedQty * (product.unitPrice || 0);
          
          return {
            productName: product.productName?.name || '',
            variantName: product.variant?.variantName || '',
            qty: product.quantity || 0,
            acceptedQty: acceptedQty,
            rate: product.unitPrice || 0,
            amt: amt,
            uom: product.saleUoM?.unit || '',
          };
        }) || [];
        
        // Recalculate total amount based on updated items
        const totalAmt = items.reduce((sum, item) => sum + item.amt, 0);
        const amountInWords = toWords(totalAmt).toUpperCase();
        

        // Format date safely
        let invoiceDate = '';
        if (invoice.invoiceDate) {
          const date = new Date(invoice.invoiceDate);
          invoiceDate = `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`;
        }

        // Build formatted data object for template
        const formattedData = {
          type: 'SALE',
          company: company?.name || '',
          invoiceNumber: invoice.invoiceNo || '',
          invoiceDate: invoiceDate,
          poNo: invoice.poNumber || '',
          vehicleNo: invoice.vehicleNo || '',
          customerCode: customer?.customerCode || '',
          partyName: customer?.organisationName || '',
          billToAddress: billToAddress ? {
            address1: billToAddress.address1 || '',
            address2: billToAddress.address2 || '',
            location: billToAddress.location || '',
            city: billToAddress.city || '',
            state: billToAddress.state || '',
            pincode: billToAddress.pincode || '',
          } : { city: '' },
          shipToAddress: shipToAddress ? {
            address1: shipToAddress.address1 || '',
            address2: shipToAddress.address2 || '',
            location: shipToAddress.location || '',
            city: shipToAddress.city || '',
            state: shipToAddress.state || '',
            pincode: shipToAddress.pincode || '',
          } : { city: '' },
          gstn: customer?.statutoryDetails?.gstn || '',
          panNo: customer?.statutoryDetails?.panNo || '',
          items: items,
          totalAmt: totalAmt,
          totalAmtInWord: amountInWords,
          bankDetails: mappedBankDetails,
        };

        await this.cacheService.set(cacheKey, formattedData, this.CACHE_TTL);
        return formattedData;
      } catch (error: any) {
        logger.error(`Error fetching invoice for PDF with ID: ${id}`, {
          error: error,
          message: error.message,
          stack: error.stack,
        });
        if (error instanceof AppError) {
          throw error;
        }
        throw new Error(`Failed to fetch invoice for PDF generation: ${error.message}`);
      }
    }
  /**
   * Update the ammountStatus (paid / unpaid) of an Invoice by its ID.
   */
  public async updateAmountStatus(
    id: string,
    status: ammountStatus,
  ): Promise<{ id: string; ammountStatus: ammountStatus }> {
    const invoice = await this.invoiceRepository.findOne({ where: { id }, withDeleted: true });
    if (!invoice) throw new AppError(404, `Invoice with ID ${id} not found`);

    invoice.ammountStatus = status;
    await this.invoiceRepository.save(invoice);

    // Invalidate all:*, update:id, view:id, pdf:id
    await this.invalidateCache(id);

    // Also invalidate view/update caches that are keyed by document ID
    try {
      const doc = await this.documentbRepository.findOne({
        where: { document_type_id: id } as any,
        select: ['id'] as any,
      });
      if (doc?.id) {
        await Promise.all([
          this.cacheService.del(`${this.CACHE_PREFIX}:view:${doc.id}`),
          this.cacheService.del(`${this.CACHE_PREFIX}:update:${doc.id}`),
        ]);
      }
    } catch (_) { /* non-critical */ }

    return { id: invoice.id, ammountStatus: invoice.ammountStatus };
  }

  public async deleteMultipleFinalInvoices(ids: string[]): Promise<BulkDeleteResultDto> {
   const success: { id: string; No: string }[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const finalInvoice = await this.invoiceRepository.findOne({
        where: { id },
      });
      if (!finalInvoice) {
        failed.push({ id, reason: 'FinalInvoice not found' });
        continue;
      }
      const relatedDocument = await this.documentbRepository.findOne({
        where: { document_type_id: finalInvoice.id }
      });

      if (!relatedDocument) {
        throw new Error(`Something went wrong`);
      }

      await this.documentbRepository.softDelete(relatedDocument.id);
      await this.documentbRepository.update(relatedDocument.id, { isDeleted: true } as any);

      await this.invoiceRepository.softDelete(finalInvoice.id);
      await this.invoiceRepository.update(finalInvoice.id, { isDeleted: true } as any);
      await this.invalidateCache(finalInvoice.id);
      success.push({id, No: finalInvoice.invoiceNo});
    } catch (error: any) {
      failed.push({ id, reason: error.message || 'Unknown error' });
    }
  }
  const message = `Deletion completed. Success: ${success.length}, Failed: ${failed.length}`;
  return { success, failed, message };
}

}


  // async update(id: string, data: any): Promise<any> {
  //   try {
  //     const invoice = await this.invoiceRepository.findOne({ where: { id } });

  //     if (!invoice) return null;

  //     const updated = Object.assign(invoice, data);
  //     const saved = await this.invoiceRepository.save(updated);
  //     await this.invalidateCache(id);
  //     return saved;
  //   } catch (err) {
  //     logger.error(`Error updating final invoice with ID: ${id}`, {
  //       error: err,
  //     });
  //     return null;
  //   }
  // }

