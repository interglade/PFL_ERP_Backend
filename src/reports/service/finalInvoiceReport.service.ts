import { inject, injectable } from "inversify";

import * as ExcelJS from 'exceljs';

import { In } from "typeorm";
import { TYPES } from "../../types";
import { DocumentbService } from "../../approvalFlow/service/documentb.service";
import { InvoiceRepository } from "../../invoice/repository/invoice.repository";
import { CompanyRepository } from "../../company/repository/company.repository";
import { BranchessRepository } from "../../branch/repository/branches.repository";
import { CustomerRepository } from "../../customer/addcustomer/repository/customer.repository";
import { UserRepository } from "../../employee/repository/user.repository";
import { ProductRepository } from "../../product/createproduct/repository/product.repository";
import { Documentb } from "../../approvalFlow/entity/docuemnt.entity";


@injectable()
export class FinalInvoiceReportService {


  constructor(
    
   
    @inject(TYPES.DocumentbService)
    private documentbService: DocumentbService,
    @inject(TYPES.InvoiceRepository)
    private invoiceRepository: InvoiceRepository,
     @inject(TYPES.CompanyRepository) 
    private readonly companyRepository: CompanyRepository,
      @inject(TYPES.BranchessRepository) 
    private readonly branchesRepository: BranchessRepository,
     @inject(TYPES.CustomerRepository) 
    private readonly customerRepo: CustomerRepository,
     @inject(TYPES.UserRepository) 
    private readonly userRepository: UserRepository,
     @inject(TYPES.ProductRepository) 
    private readonly productRepository: ProductRepository,
  ){}

  autoAdjustColumnWidth(sheet: ExcelJS.Worksheet) {
  sheet.columns?.forEach((column) => {
    let maxLength = 0;

    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const cellValue = cell.value ? cell.value.toString() : "";
      maxLength = Math.max(maxLength, cellValue.length);
    });

    column.width = maxLength + 2; // padding
  });
}
 async generateInvoiceReport(
    filter: FinalInvoiceReportFilter,
  ): Promise<Buffer> {
    let companyNames = 'All';
    let locationNames = 'All';
    let customerNames = 'All';
    let createdByNames = 'All';
    let productNames = 'All';
    let approvedByNames = 'All';
  //  let driverNames = 'All';

    const qb = this.invoiceRepository
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.companyName', 'company')
      .leftJoinAndSelect('inv.customerName', 'customer')
      .leftJoinAndSelect('inv.fromLocation', 'branch')
      .leftJoinAndSelect('inv.createdBy', 'createdBy')
      .leftJoinAndSelect('inv.deliveryChallan', 'dc')
      .leftJoinAndSelect('inv.invoiceProducts', 'item')
      .leftJoinAndSelect('item.productName', 'product')
      .leftJoinAndSelect('item.variant', 'variant')
      .leftJoinAndSelect('item.saleUoM', 'uom')
      .leftJoin(
        Documentb,
        'doc',
        'doc.document_type_id::uuid = inv.id'
      )
          .leftJoin('doc.lastActionBy', 'lastActionBy')
      
          .addSelect([
            'doc.id',
            'doc.status',
            'lastActionBy.id',
            'lastActionBy.firstName',
            'lastActionBy.lastName'
          ]);

          const formatDate = (date: any) => {
  if (!date) return '';

  const d = new Date(date);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${day}-${month}-${year}`;
};

          const normalizeArray = (val: any) => {
  if (!val) return [];

  return (Array.isArray(val) ? val : String(val).split(','))
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
};


          if (filter.approvedBy) {
          const ids = Array.isArray(filter.approvedBy)
                      ? filter.approvedBy
              : String(filter.approvedBy).split(',');
      
          qb.andWhere('lastActionBy.id IN (:...ids)', { ids });
      
          const users = await this.userRepository.findBy({ id: In(ids) });
      
          approvedByNames = users
            .map(u => `${u.firstName} ${u.lastName || ''}`)
            .join(', ');
        }

    /*
==========================
FILTERS
==========================
*/

    if (filter.startDate && filter.endDate) {
      qb.andWhere('inv.invoiceDate BETWEEN :start AND :end', {
        start: filter.startDate,
        end: filter.endDate,
      });
    }

    if (filter.company) {
      const ids = Array.isArray(filter.company)
        ? filter.company
        : String(filter.company).split(',');

      qb.andWhere('company.id IN (:...comp)', { comp: ids });

      const companies = await this.companyRepository.findBy({
        id: In(ids),
      });

      companyNames = companies.map((c) => c.name).join(', ');
    }

    if (filter.deliverFromLocation) {
      const ids = Array.isArray(filter.deliverFromLocation)
        ? filter.deliverFromLocation
        : String(filter.deliverFromLocation).split(',');

      qb.andWhere('branch.id IN (:...branch)', { branch: ids });

      const locations = await this.branchesRepository.findBy({
        id: In(ids),
      });

      locationNames = locations.map((l) => l.name).join(', ');
    }

    if (filter.customers) {
      const ids = Array.isArray(filter.customers)
        ? filter.customers
        : String(filter.customers).split(',');

      qb.andWhere('customer.id IN (:...cust)', { cust: ids });

      const customers = await this.customerRepo.findBy({
        id: In(ids),
      });

      customerNames = customers.map((c) => c.organisationName).join(', ');
    }

    if (filter.createdBy) {
      const ids = Array.isArray(filter.createdBy)
        ? filter.createdBy
        : String(filter.createdBy).split(',');

      qb.andWhere('createdBy.id IN (:...cb)', { cb: ids });

      const users = await this.userRepository.findBy({
        id: In(ids),
      });

      createdByNames = users.map((u) => u.firstName).join(', ');
    }

    if (filter.product) {
      const ids = Array.isArray(filter.product)
        ? filter.product
        : String(filter.product).split(',');

      qb.andWhere('item.product_id IN (:...p)', { p: ids });

      const products = await this.productRepository.findBy({
        id: In(ids),
      });

      productNames = products.map((p) => p.name).join(', ');
    }

    if (filter.poNumber) {
      qb.andWhere('inv.poNumber ILIKE :poNumber', {
        poNumber: `%${String(filter.poNumber).trim()}%`,
      });
    }

    // Total Quantity (>=)
    // if (filter.totalQuantity) {
    //   qb.andWhere('item.quantity >= :qty', { qty: filter.totalQuantity });
    // }

    // //ty filter range
    // if (filter.minQuantity && filter.maxQuantity) {
    //   qb.andWhere('item.quantity BETWEEN :minQty AND :maxQty', {
    //     minQty: filter.minQuantity,
    //     maxQty: filter.maxQuantity,
    //   });
    // } else if (filter.minQuantity) {
    //   qb.andWhere('item.quantity >= :minQty', { minQty: filter.minQuantity });
    // } else if (filter.maxQuantity) {
    //   qb.andWhere('item.quantity <= :maxQty', { maxQty: filter.maxQuantity });
    // }

    if (filter.totalQuantity !== undefined && filter.totalQuantityOperator) {
      const operator = filter.totalQuantityOperator;

      qb.andWhere(`item.quantity ${operator} :qty`, {
        qty: filter.totalQuantity,
      });
    }

    // Total Amount (>=)
    // if (filter.totalAmount) {
    //   qb.andWhere('inv.totalProductAmount >= :amt', {
    //     amt: filter.totalAmount,
    //   });
    // }

    // if (filter.minTotalAmount && filter.maxTotalAmount) {
    //   qb.andWhere('inv.totalProductAmount BETWEEN :minAmt AND :maxAmt', {
    //     minAmt: filter.minTotalAmount,
    //     maxAmt: filter.maxTotalAmount,
    //   });
    // } else if (filter.minTotalAmount) {
    //   qb.andWhere('inv.totalProductAmount >= :minAmt', {
    //     minAmt: filter.minTotalAmount,
    //   });
    // } else if (filter.maxTotalAmount) {
    //   qb.andWhere('inv.totalProductAmount <= :maxAmt', {
    //     maxAmt: filter.maxTotalAmount,
    //   });
    // }

    if (filter.totalAmount !== undefined && filter.totalAmountOperator) {
      const operator = filter.totalAmountOperator;

      qb.andWhere(`inv.totalProductAmount ${operator} :amt`, {
        amt: filter.totalAmount,
      });
    }

    // have multiple Driver Name

    // if (filter.driverName) {
    //   const diverName = Array.isArray(filter.driverName)
    //     ? filter.driverName
    //     : String(filter.driverName).split(',');
    //   qb.andWhere('dc.driverName IN (:...driver)', { driver: diverName });
    // }

    if (filter.driverName) {
      const diverName = normalizeArray(filter.driverName)
      qb.andWhere(
    `LOWER(dc.driverName) IN (:...driver)`,
    {
      driver: diverName.map(d => d.trim().toLowerCase()),
    }
  );
    }

    //have multiple Driver License Number
    // if (filter.driverLicenseNumber) {
    //   const licenseNumbers = Array.isArray(filter.driverLicenseNumber)
    //     ? filter.driverLicenseNumber
    //     : String(filter.driverLicenseNumber).split(',');
    //   qb.andWhere('dc.licenseNo IN (:...lic)', { lic: licenseNumbers });
    // }

    if (filter.driverLicenseNumber) {
  const values = normalizeArray(filter.driverLicenseNumber);

  qb.andWhere(`LOWER(dc.licenseNo) IN (:...lic)`, {
    lic: values,
  });
}

    //have multiple Vehicle Number
    // if (filter.vehicleNumber) {
    //   const vehicleNumbers = Array.isArray(filter.vehicleNumber)
    //     ? filter.vehicleNumber
    //     : String(filter.vehicleNumber).split(',');
    //   qb.andWhere('inv.vehicleNo IN (:...veh)', { veh: vehicleNumbers });
    // }

    if (filter.vehicleNumber) {
  const values = normalizeArray(filter.vehicleNumber);

  qb.andWhere(`LOWER(inv.vehicleNo) IN (:...veh)`, {
    veh: values,
  });
}

    //have multiple Receiver Name
    // if (filter.receiverName) {
    //   const receiverNames = Array.isArray(filter.receiverName)
    //     ? filter.receiverName
    //     : String(filter.receiverName).split(',');
    //   qb.andWhere('dc.receiverName IN (:...rec)', { rec: receiverNames });
    // }

    if (filter.receiverName) {
  const values = normalizeArray(filter.receiverName);

  qb.andWhere(`LOWER(dc.receiverName) IN (:...rec)`, {
    rec: values,
  });
}

if (filter.rmName) {
  const values = normalizeArray(filter.rmName);

  qb.andWhere(`LOWER(dc.rmn) IN (:...rm)`, {
    rm: values,
  });
}

if (filter.status) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : String(filter.status).split(',');
      qb.andWhere('doc.status IN (:...status)', { status: statuses });
    }

    // const invoices = await qb.getMany();

    const { entities, raw } = await qb.getRawAndEntities();

    const docMap: Record<string, any> = {};

  raw.forEach(r => {
    docMap[r.inv_id] = {
      status: r.doc_status,
      approvedBy: `${r.lastActionBy_firstName || ''} ${r.lastActionBy_lastName || ''}`.trim()
    };
  });

  const invoices = entities;

  

    // const documentbMap: Record<string, any> = {};
    // for (const dc of invoices) {
    //   try {
    //     const documentb = await this.documentbService.getDocumentByTypeId(
    //       dc.id,
    //     );
    //     if (documentb) {
    //       documentbMap[dc.id] = documentb;
    //     }
    //   } catch (e) {
    //     // Optionally log error
    //   }
    // }

    /*
==========================
SUMMARY
==========================
*/

    const totalInvoices = invoices.length;

    let totalQuantity = 0;
    let totalInvoiceAmount = 0;

    for (const inv of invoices) {
      totalInvoiceAmount += Number(inv.totalAmount || 0);

      if (inv.invoiceProducts?.length) {
        for (const item of inv.invoiceProducts) {
          totalQuantity += Number(item.quantity || 0);
        }
      }
    }

    /*
==========================
CREATE EXCEL
==========================
*/

    const workbook = new ExcelJS.Workbook();

    /*
==========================
SHEET 1 : SUMMARY
==========================
*/

    const summarySheet = workbook.addWorksheet('Report_Summary');

    summarySheet.columns = [{ width: 30 }, { width: 40 }];

    summarySheet.mergeCells('A1:B1');

    const titleCell = summarySheet.getCell('A1');

    titleCell.value = 'Invoice Detailed Report';

    titleCell.font = {
      bold: true,
      size: 14,
      color: { argb: 'FFFFFFFF' },
    };

    titleCell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };

    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B050' },
    };

    /*
REPORT DETAILS
*/

    summarySheet.addRow([]);

    const reportDetails = [
      ['Company Name:', 'Prime Fresh Limited'],
      ['Generated By:', `${invoices[0]?.createdBy?.firstName} ${invoices[0]?.createdBy?.lastName}` || 'System'],
      ['Generated Date:', new Date().toLocaleDateString()],
    ];

    reportDetails.forEach((r) => {
      const row = summarySheet.addRow(r);

      row.eachCell((cell, col) => {
        if (col === 1) cell.font = { bold: true };

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        cell.alignment = {
          wrapText: true,
          vertical: 'middle',
        };
      });
    });

    summarySheet.addRow([]);

    /*
APPLIED FILTERS HEADER
*/

    const filterHeader = summarySheet.addRow(['Applied Filters']);

    summarySheet.mergeCells(`A${filterHeader.number}:B${filterHeader.number}`);

    filterHeader.font = { bold: true };

    filterHeader.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' },
      };

      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    /*
FILTER VALUES
*/

const formatFilterValue = (val: any) => {
  if (!val) return 'All';
  if (Array.isArray(val)) return val.join(', ');
  return val;
};




    const filters = [
      ['Start Date', formatDate(filter.startDate) || 'All'],
      ['End Date', formatDate(filter.endDate) || 'All'],
      [
        'Reporting Peroid',
        formatDate(filter.startDate) && formatDate(filter.endDate)
          ? `${formatDate(filter.startDate)} - ${formatDate(filter.endDate)}`
          : 'All',
      ],
      ['Company', companyNames || 'All'],
      ['Deliver From Location', locationNames || 'All'],
      ['Customers', customerNames || 'All'],
      ['Created By', createdByNames || 'All'],
      ['Product', productNames || 'All'],
      ['PO Number', formatFilterValue(filter.poNumber) || 'All'],
      // ['PO Number', Array.isArray(filter.poNumber) ? filter.poNumber.join(', ') : (filter.poNumber || 'All')],
      //   ["Total Quantity", `< ${filter.minQuantity} and >${filter.maxQuantity}` || "All"],
      //   ["Total Amount", "< "+filter.minTotalAmount+" and >"+filter.maxTotalAmount || "All"],
      [
        'Total Quantity',
        filter.totalQuantity !== undefined && filter.totalQuantityOperator
          ? `${filter.totalQuantityOperator} ${filter.totalQuantity}`
          : 'All',
      ],

      [
        'Total Amount',
        filter.totalAmount !== undefined && filter.totalAmountOperator
          ? `${filter.totalAmountOperator} ${filter.totalAmount}`
          : 'All',
      ],
      ['Driver Name', formatFilterValue(filter.driverName) || 'All'],
      // ['Driver Name', Array.isArray(filter.driverName) ? filter.driverName.join(', ') : (filter.driverName || 'All')],
      ["Driver's License Number", formatFilterValue(filter.driverLicenseNumber) || 'All'],
      // ["Driver's License Number", Array.isArray(filter.driverLicenseNumber) ? filter.driverLicenseNumber.join(', ') : (filter.driverLicenseNumber || 'All')],
      ['Vehicle Number', formatFilterValue(filter.vehicleNumber) || 'All'],
      // ['Vehicle Number', Array.isArray(filter.vehicleNumber) ? filter.vehicleNumber.join(', ') : (filter.vehicleNumber || 'All')],
      ['Receiver Name', formatFilterValue(filter.receiverName) || 'All'],
      //  ['Receiver Name', Array.isArray(filter.receiverName) ? filter.receiverName.join(', ') : (filter.receiverName || 'All')],
      ['RM Name', formatFilterValue(filter.rmName) || 'All'],
      // ['RM Name', Array.isArray(filter.rmName) ? filter.rmName.join(', ') : (filter.rmName || 'All')]
      ['Approved By', approvedByNames || 'All'],
      ['Status', filter.status || 'All'],
    ];

    filters.forEach((f) => {
      const row = summarySheet.addRow(f);

      row.eachCell((cell, col) => {
        if (col === 1) cell.font = { bold: true };

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        cell.alignment = {
          wrapText: true,
          vertical: 'middle',
        };
      });
    });

    summarySheet.addRow([]);

    /*
SUMMARY HEADER
*/

    const summaryHeader = summarySheet.addRow(['Summary']);

    summarySheet.mergeCells(
      `A${summaryHeader.number}:B${summaryHeader.number}`,
    );

    summaryHeader.font = { bold: true };

    summaryHeader.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' },
      };

      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    /*
SUMMARY
*/

    const summaryRows = [
      ['Total Invoices', totalInvoices],
      ['Total Quantity', totalQuantity],
      ['Total Invoice Amount', totalInvoiceAmount],
    ];

    summaryRows.forEach((s) => {
      const row = summarySheet.addRow(s);

      row.eachCell((cell, col) => {
        if (col === 1) cell.font = { bold: true };

        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    /*
==========================
SHEET 2 : DATA
==========================
*/

    const dataSheet = workbook.addWorksheet('Report_Data');

    dataSheet.columns = [
      { header: 'Invoice Date', key: 'date', width: 14 },
      { header: 'Status', key: 'status', width: 12 },

      { header: 'Invoice No', key: 'invoiceNo', width: 18 },
      { header: 'Created By', key: 'createdBy', width: 18 },
      { header: 'PO Number', key: 'poNumber', width: 15 },
      { header: 'Customer Name', key: 'customerName', width: 22 },
      { header: 'Company Name', key: 'companyName', width: 22 },
      { header: 'Place Of Supply', key: 'placeOfSupply', width: 20 },

      { header: 'Product Name', key: 'productName', width: 20 },
      { header: 'Variant Name', key: 'variant', width: 25 },
      { header: 'UoM', key: 'salesUom', width: 12 },
      { header: 'Qty', key: 'qty', width: 12 },
      { header: 'Unit Price', key: 'unitPrice', width: 14 },
      { header: 'Amount', key: 'amount', width: 14 },

      { header: 'Gross Weight', key: 'grossWeight', width: 15 },
      { header: 'Net Weight', key: 'netWeight', width: 15 },

      { header: 'Total Net Weight', key: 'totalGrossWeight', width: 18 },

      { header: 'Total Net Weight', key: 'totalNetWeight', width: 18 },
      { header: 'Total Amount', key: 'totalAmount', width: 18 },

      { header: 'Vehicle No', key: 'vehicleNo', width: 15 },
      { header: 'RM Name', key: 'rmName', width: 18 },

      { header: 'Approved By', key: 'approvedBy', width: 18 },
    ];

    /*
HEADER STYLE
*/

    const headerRow = dataSheet.getRow(1);

    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFDE21' },
      };

      cell.font = { bold: true };

      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
    });

    /*
STATUS MAPPING (VALUE → LABEL + COLOR)
*/

    const STATUS_MAP: Record<string, { label: string; color: string }> = {
      hold: { label: 'Hold', color: 'FFFF5700' },
      VERIFIED: { label: 'Verified', color: 'FF6A00FF' },
      approved: { label: 'Approved', color: 'FF40BF40' },
      FINALIZING: { label: 'Finalized', color: 'FF0063B1' },
      COMPLETE: { label: 'Complete', color: 'FF006600' },
      REJECT: { label: 'Reject', color: 'FFAF0606' },
    };

    /*
ADD DATA
*/

    for (const inv of invoices) {
      if (!inv.invoiceProducts?.length) continue;

      const startRow = dataSheet.rowCount + 1;

      const documentb = docMap[inv.id]

      const statusValue = documentb?.status || '';
      //console.log("status"+statusValue+"--------------------");
      
      const statusInfo = STATUS_MAP[statusValue] || {
        label: statusValue,
        color: 'FFE7E6E6',
      };

      const approvedBy = documentb?.approvedBy || '';

        const to2Decimal = (val: any) =>
  val !== null && val !== undefined
    ? Number(parseFloat(val).toFixed(2))
    : 0;

    const totalGrossWeight = inv.invoiceProducts?.reduce(
        (sum, p) => sum + Number(p.grossWeight || 0),
        0
      );

      for (const item of inv.invoiceProducts) {
        const row = dataSheet.addRow({
          date: inv.invoiceDate,

          status: statusInfo.label,

          invoiceNo: inv.invoiceNo.toUpperCase(),

          createdBy: `${inv.createdBy?.firstName} ${inv.createdBy?.lastName}`,

          poNumber: inv.poNumber,

          customerName: inv.customerName?.organisationName,

          companyName: inv.companyName?.name,

          placeOfSupply: inv.placeOfSupply,

          productName: item.productName?.name,

          variant: item.variant?.variantName,

          salesUom: item.saleUoM?.unit,

          qty: to2Decimal(item.quantity),

          unitPrice: to2Decimal(item.unitPrice),

          amount: to2Decimal(item.amount),

          grossWeight: to2Decimal(item.grossWeight),

          netWeight: to2Decimal(item.netWeight),

          totalGrossWeight: to2Decimal(totalGrossWeight),

          totalNetWeight: to2Decimal(inv.netProductWeight),

          totalAmount: to2Decimal(inv.totalAmount),

          vehicleNo: inv.vehicleNo.toUpperCase(),

          rmName: inv.createdBy?.firstName,

          approvedBy: approvedBy,
        });

        const statusCell = row.getCell(2);

        row.alignment = {
         // horizontal: 'center',
          vertical: 'middle',
        };

        

        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: statusInfo.color },
        };

        statusCell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' },
        };

        statusCell.alignment = {
       //   horizontal: 'center',
          vertical: 'middle',
        };
      }

      const endRow = dataSheet.rowCount;

      if (endRow > startRow) {
        const mergeCols = [1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19,20, 21,22];

        mergeCols.forEach((col) => {
          dataSheet.mergeCells(startRow, col, endRow, col);
        });
      }
    }

    this.autoAdjustColumnWidth(dataSheet);

    const buffer = await workbook.xlsx.writeBuffer();

    return buffer as unknown as Buffer;
  }
}




//------------------------------------



export interface FinalInvoiceReportFilter {
  startDate?: string;
  endDate?: string;
  referredGrn?: string | string[];
  company?: string | string[];
  deliverFromLocation?: string | string[];
  poNumber?: string;
  customers?: string | string[];
  createdBy?: string | string[];
  product?: string | string[];
  totalQuantity?: number;
  totalQuantityOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  totalAmount?: number;
  totalAmountOperator?: '>' | '<' | '=' | '>=' | '<=' | '!=';
  driverName?: string | string[];
  driverLicenseNumber?: string | string[];
  vehicleNumber?: string | string[];
  receiverName?: string | string[];
  status?: string | string[];
  rmName?: string;
  approvedBy?: string;
}



  
