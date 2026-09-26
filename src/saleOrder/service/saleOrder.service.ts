import { inject, injectable } from "inversify";
import { TYPES } from "../../types";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import { SaleOrderRepository } from "../repository/saleOrder.repository";
import { SaleOrder } from "../entity/saleOrder.entity";



@injectable()
export class SaleOrderService {

    constructor(@inject(TYPES.SaleOrderRepository) private saleOrderRepository:SaleOrderRepository,
 @inject(TYPES.AuditLogService)
       private readonly auditLogService:AuditLogService,){

    }

// Create a new SaleOrder with Products
async createSaleOrder(saleOrderData: any): Promise<any> {
    const saleOrder = this.saleOrderRepository.create(saleOrderData);
   
    return await this.saleOrderRepository.save(saleOrder);
  }

  // Get a SaleOrder by ID with Products
  async getSaleOrderById(id: string): Promise<SaleOrder | null> {
    return await this.saleOrderRepository.findOne({
      where: { id },
      relations: ['saleProducts'],
    });
  }

  async updateSaleOrder(
    id: string,
    saleOrderData: any,
    
    updatedBy: string
  ): Promise<SaleOrder | null> {
    // Find the existing SaleOrder
    const existingSaleOrder = await this.saleOrderRepository.findOne({
      where: { id },
      relations: ["saleProducts"], // Ensure related products are loaded
    });
  
    if (!existingSaleOrder) {
      return null; // If SaleOrder not found, return null
    }
  
    // Capture the original state for audit purposes
    const originalSaleOrder = { ...existingSaleOrder };
  
    // Merge the new data into the existing SaleOrder
    this.saleOrderRepository.merge(existingSaleOrder, saleOrderData);
  
    
  
    // Save the updated SaleOrder
    const updatedSaleOrder = await this.saleOrderRepository.save(existingSaleOrder);
  
    // Log the changes to AuditLog
    await this.auditLogService.logChange(
      "SaleOrder",
      updatedSaleOrder.id,
      originalSaleOrder,
      updatedSaleOrder,
      updatedBy
    );
  
    return updatedSaleOrder;
  }
  

  // Delete a SaleOrder by ID
  async deleteSaleOrder(id: string): Promise<void> {
    await this.saleOrderRepository.delete(id);
  }

  // Get all SaleOrders with Products
  async getAllSaleOrders(): Promise<SaleOrder[]> {
    return await this.saleOrderRepository.find({ relations: ['saleProducts'] });
  }
}