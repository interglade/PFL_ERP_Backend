import { inject, injectable } from "inversify";
import { TYPES } from "../../../types";
import { BankDetailsvendRepository } from "../repository/vendorBankDetails.repository";
import { AddressService } from "../../../address/service/address.service";
import { BankDetailsvend } from "../entity/bankDetailsVend.entity";


@injectable()
export class BankDetailsvendService {
  constructor(
    @inject(TYPES.BankDetailsvendRepository)
    private readonly bankDetailsvendRepository: BankDetailsvendRepository,
    @inject(TYPES.AddressService)
    private readonly addressService: AddressService,
  ) {}

  async createBankDetails(data:any): Promise<BankDetailsvend[]> {
   
  
    // Handle creation of Address if provided
    if (data.branchAddress) {
      data.branchAddress = await this.addressService.create(data.branchAddress);
      
    }
   
    // Create new BankDetailsVend entity
    const bankDetails = this.bankDetailsvendRepository.create(data);
  
    // Save BankDetailsVend entity to the database and return the saved entity
    return await this.bankDetailsvendRepository.save(bankDetails);
  }
  
  async getBankDetails(id: string): Promise<BankDetailsvend | null> {
    return await this.bankDetailsvendRepository.findOneBy({ id });
  }

  async updateBankDetails(id: string, data: any): Promise<BankDetailsvend | null> {
    const bankDetails = await this.bankDetailsvendRepository.findOneBy({ id });

    if (!bankDetails) {
      return null;
    }

    Object.assign(bankDetails, data);
    return await this.bankDetailsvendRepository.save(bankDetails);
  }

  async deleteBankDetails(id: string): Promise<void> {
    await this.bankDetailsvendRepository.delete({ id });
  }
}
