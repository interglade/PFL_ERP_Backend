import { inject, injectable } from 'inversify';
import { TYPES } from '../../../types';
import { OfficeUseOnlyCustRepository } from '../repository/officeUseOnlyCust.repository';
import { OfficeUseOnly } from '../entity/officeUseOnlyCust.entity';

@injectable()
export class OfficeUseOnlyCustService {
  constructor(
    @inject(TYPES.OfficeUseOnlyCustRepository)
    private readonly officeUseOnlyCustRepository: OfficeUseOnlyCustRepository
  ) {}

  // Create a new OfficeUseOnly record
  async create(data: Partial<OfficeUseOnly>): Promise<OfficeUseOnly> {
    const officeUseOnly = this.officeUseOnlyCustRepository.create(data);
    return this.officeUseOnlyCustRepository.save(officeUseOnly);
  }

  // Find an OfficeUseOnly record by ID
  async findById(id: string): Promise<OfficeUseOnly | null> {
    return this.officeUseOnlyCustRepository.findOneBy({ id });
  }

  // Update an OfficeUseOnly record by ID
  async update(id: string, data: Partial<OfficeUseOnly>): Promise<OfficeUseOnly | null> {
    const officeUseOnly = await this.officeUseOnlyCustRepository.findOneBy({ id });
    if (officeUseOnly) {
      Object.assign(officeUseOnly, data);
      return this.officeUseOnlyCustRepository.save(officeUseOnly);
    }
    return null;
  }

  // Find all OfficeUseOnly records with optional filter criteria
  async findAll(filter: Partial<OfficeUseOnly> = {}): Promise<OfficeUseOnly[]> {
    return this.officeUseOnlyCustRepository.find({  order: {
      createdAt: 'DESC', // Assuming createdAt is a timestamp field 
    },});
  }
}
