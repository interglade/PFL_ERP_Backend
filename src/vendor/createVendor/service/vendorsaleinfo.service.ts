import { inject, injectable } from "inversify";
import { VendorSaleInfoRepository } from "../repository/vendorSaleInfo.repository";
import { TYPES } from "../../../types";
import { AnyARecord } from "node:dns";
import { VendorSaleInfo } from "../entity/vendorsaleinfo.entity";


@injectable()
export class VendorSaleInfoService {
  

  constructor(
    @inject(TYPES.VendorSaleInfoRepository)
    private readonly vendorSaleInfoRepository: VendorSaleInfoRepository,
  ) {}

 // Create a new VendorSaleInfo
 async createVendorSaleInfo(data:any): Promise<any> {
    const vendorSaleInfo = this.vendorSaleInfoRepository.create(data);
    return await this.vendorSaleInfoRepository.save(vendorSaleInfo);
  }

  // Get a VendorSaleInfo by ID
  async getVendorSaleInfoById(id: string): Promise<VendorSaleInfo | null> {
    return await this.vendorSaleInfoRepository.findOne({
      where: { id },
      relations: ["vendor"], // Include related vendor data if needed
    });
  }

  // Update an existing VendorSaleInfo
  async updateVendorSaleInfo(id: string, data:any): Promise<VendorSaleInfo | null> {
    await this.vendorSaleInfoRepository.update(id, data);
    return this.getVendorSaleInfoById(id);
  }

  // Delete a VendorSaleInfo
  async deleteVendorSaleInfo(id: string): Promise<void> {
    await this.vendorSaleInfoRepository.delete(id);
  }

  // Get all VendorSaleInfo records
  async getAllVendorSaleInfo(): Promise<VendorSaleInfo[]> {
    return await this.vendorSaleInfoRepository.find(  {order: {
      createdAt: 'DESC', // Assuming createdAt is a timestamp field 
    },});
  }

  // Associate VendorSaleInfo with a Vendor
  async associateVendorSaleInfoWithVendor(vendorSaleInfoId: string, vendorId: string): Promise<VendorSaleInfo | undefined> {
    const vendorSaleInfo = await this.getVendorSaleInfoById(vendorSaleInfoId);
    if (!vendorSaleInfo) {
      throw new Error("VendorSaleInfo not found");
    }

    const vendor = await this.vendorSaleInfoRepository.findOne({ where: { id: vendorId } });
    if (!vendor) {
      throw new Error("Vendor not found");
    }

    
    return await this.vendorSaleInfoRepository.save(vendorSaleInfo);
  }
}