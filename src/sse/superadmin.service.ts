import { inject, injectable } from "inversify";

import { TYPES } from "../types";
import { DealSlipRepository } from "../dealSlip/repository/dealSlip.repository";

import { InwardRepository } from "../inwardRegister/repository/inwardRegister.repository";
import { VehicleDispatchRepository } from "../vehicleDispatch/repository/vehicleDispatch.repository";
;
import { PackingMaterialRepository } from "../packingMaterial/repository/packingMaterial.repository";

import { DumpRegisterRepository } from "../dumpRegister/repository/dumpRegister.repository";
import { EodRepository } from "../eodStock/repository/eodstockreport.repository";
import { InvoiceRepository } from "../invoice/repository/invoice.repository";
import { SecondSaleRepository } from "../secondSale/repository/secondSale.repository";
import { DocumentbRepository } from "../approvalFlow/repository/documentb.repository";
import { GrnRepository } from "../grn/repository/grn.repository";
import { RfpaRepository } from "../rfpa/repository/rfpa.repository";
import { AqrRepository } from "../aqr/repository/aqr.repository";
import { MultiCashVoucherRepository } from "../vouchers/multiCashV/repository/multicashVoucher.repository";
import { TPVoucherRepository } from "../vouchers/tranportPaymentV/repository/transportPaymentV.repository";
import { LabourPaymentVoucherRepository } from "../vouchers/labourPaymentV/repository/labourPaymentVoucher.repository";
import { PostReturnByCustomerRepository } from "../returnByCustomer/repository/postReturnByCustomer.repository";


@injectable()
export class SuperAdminService {
  constructor(
     @inject(TYPES.DocumentbRepository)
    private readonly documentRepo: DocumentbRepository,
     @inject(TYPES.GrnRepository)
    private readonly grnRepo: GrnRepository,
    @inject(TYPES.RfpaRepository)
    private readonly rfpaRepo: RfpaRepository,
    @inject(TYPES.DealSlipRepository)
    private readonly dealSlipRepo: DealSlipRepository,
    @inject(TYPES.InwardRepository)
    private readonly inwardRepo: InwardRepository,
    @inject(TYPES.VehicleDispatchRepository)
    private readonly vehicleDispatchRepo: VehicleDispatchRepository,
    @inject(TYPES.AqrRepository)
    private readonly aqrRepo: AqrRepository,
    @inject(TYPES.MultiCashVoucherRepository)
    private readonly multiCashVoucherRepo: MultiCashVoucherRepository,
    @inject(TYPES.PackingMaterialRepository)
    private readonly packingMaterialRepo: PackingMaterialRepository,
    @inject(TYPES.TPVoucherRepository)
    private readonly tpVoucherRepo: TPVoucherRepository,
    @inject(TYPES.LabourPaymentVoucherRepository)
    private readonly labourPaymentVoucherRepo: LabourPaymentVoucherRepository,
    @inject(TYPES.DumpRegisterRepository)
    private readonly dumpRegisterRepo: DumpRegisterRepository,
    @inject(TYPES.EodRepository)
    private readonly eodRepo: EodRepository,
    @inject(TYPES.InvoiceRepository)
    private readonly invoiceRepo: InvoiceRepository,
    @inject(TYPES.SecondSaleRepository)
    private readonly secondSaleRepo: SecondSaleRepository,
    @inject(TYPES.PostReturnByCustomerRepository)
    private readonly postReturnByCustomerRepo: PostReturnByCustomerRepository
  ) {}

  async softDeleteDocument(id: string) : Promise<any> {
    try{
     const doc = await this.documentRepo.findOne({ where: { id: id } });
    if (!doc) throw new Error("Document not found");

    doc.isDeleted = true;
    doc.deletedAt = new Date();

    if (!doc.document_type_id) throw new Error("Document has no associated entity ID");

    // Update related document entity
  switch (doc.type) {
    case 'grn':
      await this.grnRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'rfpa':
      await this.rfpaRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'deal-slip':
      await this.dealSlipRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'inward-register':
      await this.inwardRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;    
    case 'vehicle-dispatch-register':
      await this.vehicleDispatchRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'aqr':
      await this.aqrRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'multi-cash-voucher':
      await this.multiCashVoucherRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'packaging-material-voucher':
      await this.packingMaterialRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'transport-payment-voucher':
      await this.tpVoucherRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'labor-payment-voucher':
      await this.labourPaymentVoucherRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'dump-register':   
      await this.dumpRegisterRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'eod-report':
      await this.eodRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'return-by-customer':
      await this.postReturnByCustomerRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'second-sale':
      await this.secondSaleRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    case 'final-invoice':
      await this.invoiceRepo.update(doc.document_type_id, { isDeleted: true, deletedAt: new Date() });
      break;
    default:
      throw new Error("Unsupported document type");
  }
    await this.documentRepo.save(doc);
    return { Message: "Document moved to recycle bin" };
    }catch(error){
      throw error;
  }
}

async restoreDocument(id: string): Promise<any> {

    try{
     const doc = await this.documentRepo.findOne({ where: { id: id } });
    if (!doc) throw new Error("Document not found");

    doc.isDeleted = false;

    if (!doc.document_type_id) throw new Error("Document has no associated entity ID");

    // Update related document entity
  switch (doc.type) {
    case 'grn':
      await this.grnRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'rfpa':
      await this.rfpaRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'deal-slip':
      await this.dealSlipRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'inward-register':
      await this.inwardRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'vehicle-dispatch-register':
      await this.vehicleDispatchRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'aqr':
      await this.aqrRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'multi-cash-voucher':
      await this.multiCashVoucherRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'packaging-material-voucher':
      await this.packingMaterialRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'transport-payment-voucher':
      await this.tpVoucherRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'labor-payment-voucher':
      await this.labourPaymentVoucherRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'dump-register':
      await this.dumpRegisterRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'eod-report':
      await this.eodRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'return-by-customer':
      await this.postReturnByCustomerRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'second-sale':
      await this.secondSaleRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    case 'final-invoice':
      await this.invoiceRepo.update(doc.document_type_id, { isDeleted: false, deletedAt: undefined });
      break;
    default:
      throw new Error("Unsupported document type");
  }
    await this.documentRepo.save(doc);
    return { Message: "Document restored successfully" };
    }catch(error){
      throw error;
  }

}

async permanentDeleteDocument(id: string): Promise<any> {
    try {
        
        const doc = await this.documentRepo.findOne({ where: { id: id } });
    if (!doc) throw new Error("Document not found");
    if (!doc.document_type_id) throw new Error("Document has no associated entity ID");

    // Delete related entity record
    if (doc.type === "grn") await this.grnRepo.delete(doc.document_type_id);
    else if (doc.type === "rfpa") await this.rfpaRepo.delete(doc.document_type_id);
    else if (doc.type === "deal-slip") await this.dealSlipRepo.delete(doc.document_type_id);
    else if (doc.type === "inward-register") await this.inwardRepo.delete(doc.document_type_id);
    else if (doc.type === "vehicle-dispatch-register") await this.vehicleDispatchRepo.delete(doc.document_type_id);
    else if (doc.type === "aqr") await this.aqrRepo.delete(doc.document_type_id);
    else if (doc.type === "multi-cash-voucher") await this.multiCashVoucherRepo.delete(doc.document_type_id);
    else if (doc.type === "packaging-material-voucher") await this.packingMaterialRepo.delete(doc.document_type_id);
    else if (doc.type === "transport-payment-voucher") await this.tpVoucherRepo.delete(doc.document_type_id);
    else if (doc.type === "labor-payment-voucher") await this.labourPaymentVoucherRepo.delete(doc.document_type_id);
    else if (doc.type === "dump-register") await this.dumpRegisterRepo.delete(doc.document_type_id);
    else if (doc.type === "eod-report") await this.eodRepo.delete(doc.document_type_id);
    else if (doc.type === "final-invoice") await this.invoiceRepo.delete(doc.document_type_id);
    else if (doc.type === "second-sale") await this.secondSaleRepo.delete(doc.document_type_id);
    else if (doc.type === "return-by-customer") await this.postReturnByCustomerRepo.delete(doc.document_type_id);
    else throw new Error("Unsupported document type");
    await this.documentRepo.delete(id);
    } catch (error) {
        throw error;
    }
}
}