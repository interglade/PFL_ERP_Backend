import { inject, injectable } from 'inversify';



import { PaymentTerms } from '../entity/paymentDetailsCust.entity';
import { TYPES } from '../../../types';
import { PaymentTermsRepository } from '../repository/paymentTermsCust.repository';

@injectable()
export class PaymentTermsService {
  constructor(
    @inject(TYPES.PaymentTermsRepository)
    private readonly paymentTermsRepository: PaymentTermsRepository
  ) {}

  // Create PaymentTerms for a Customer
  public async createPaymentTerms(paymentTermsData: Partial<PaymentTerms>): Promise<PaymentTerms> {
    const paymentTerms = this.paymentTermsRepository.create({
      ...paymentTermsData,
    
    });
    return await this.paymentTermsRepository.save(paymentTerms);
  }

  // Get PaymentTerms by ID
  public async getPaymentTermsById(id: string): Promise<PaymentTerms | null> {
    return await this.paymentTermsRepository.findOne({where:{id}, 
        relations: ['customer'] });
  }

  // Get PaymentTerms by Customer ID
  public async getPaymentTermsByCustomerId(customerId: string): Promise<PaymentTerms | null> {
    return await this.paymentTermsRepository.findOne({
      where: { customer: { id: customerId } },
      relations: ['customer']
    });
  }

  // Update PaymentTerms
  public async updatePaymentTerms(id: string, updateData: Partial<PaymentTerms>): Promise<PaymentTerms | null> {
    const paymentTerms = await this.paymentTermsRepository.findOne({where:{id}});
    if (!paymentTerms) {
      return null;
    }
    
    Object.assign(paymentTerms, updateData);
    return await this.paymentTermsRepository.save(paymentTerms);
  }

  
}
