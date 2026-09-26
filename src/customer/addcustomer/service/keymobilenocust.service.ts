import { inject, injectable } from 'inversify';
import { TYPES } from '../../../types';

import { KeyMobileNoDataRepository } from '../repository/keyMobileNoDataCust.repository';
import { keyMobileNoData } from '../entity/keyMobileNoCust.entity';

@injectable()
export class KeyMobileNoDataService {
  constructor(
    @inject(TYPES.KeyMobileNoDataRepository)
    private readonly keyMobileNoDataRepository: KeyMobileNoDataRepository
  ) {}
// Create a new key mobile number data record
async createKeyMobileNoData(data: Partial<keyMobileNoData>): Promise<keyMobileNoData> {
  const newKeyMobileNoData = this.keyMobileNoDataRepository.create(data);
  return await this.keyMobileNoDataRepository.save(newKeyMobileNoData);
}

// Get key mobile number data by ID
async getKeyMobileNoDataById(id: string): Promise<keyMobileNoData | null> {
  return await this.keyMobileNoDataRepository.findOne({ where :{id}
    , 
    relations: ['ref1Address', 'ref2Address', 'customer'],
  });
}

// Update key mobile number data
async updateKeyMobileNoData(id: string, data: Partial<keyMobileNoData>): Promise<keyMobileNoData|null> {
  await this.keyMobileNoDataRepository.update(id, data);
  return this.getKeyMobileNoDataById(id);
}

// Delete key mobile number data by ID
async deleteKeyMobileNoData(id: string): Promise<void> {
  await this.keyMobileNoDataRepository.delete(id);
}

// Get all key mobile number data records
async getAllKeyMobileNoData(): Promise<keyMobileNoData[]> {
  return await this.keyMobileNoDataRepository.find({
    relations: ['ref1Address', 'ref2Address', 'customer'],
    order: {
      createdAt: 'DESC', // Assuming createdAt is a timestamp field 
    },
  });
}
}