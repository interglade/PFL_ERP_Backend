import { inject, injectable } from 'inversify';

import { DataSource } from 'typeorm';

import axios from 'axios';
import https from 'https';
import { AddressRepository } from '../repository/address.repository';
import { TYPES } from '../../types';
import { Address } from '../entity/address.entity';
import { CacheService } from '../../global/cache.service';

// Bypass expired SSL cert on api.postalpincode.in
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const CACHE_TTL_PINCODE = 86400; // 24 hours — pincode data rarely changes
const CACHE_TTL_ADDRESS = 300;   // 5 minutes
const CACHE_PREFIX = 'address';

@injectable()
export class AddressService {
  private addressRepository: AddressRepository;

  constructor(
    @inject(TYPES.DataSource) private dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
  ) {
    this.addressRepository = this.dataSource.getRepository(Address);
  }


  // ─── Fetch By Pincode (cached) ────────────────────────────────────────────

  public async fetchAddressByPincode(pincode: string): Promise<any> {
    const key = `${CACHE_PREFIX}:pincode:${pincode}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const response = await axios.get(`https://api.postalpincode.in/pincode/${pincode}`, { httpsAgent });
    const data: any = response.data;

    if (data[0]?.Status === 'Success' && data[0].PostOffice?.length > 0) {
      const postOffice = data[0].PostOffice[0];
      const result = {
        pincode,
        district: postOffice.District,
        state: postOffice.State,
        country: postOffice.Country,
      };

      await this.cacheService.set(key, result, CACHE_TTL_PINCODE);
      return result;
    }

    throw new Error('Invalid pincode or no data found');
  }

  //TODO:Create
  public async create(addressData: Partial<Address>): Promise<Address> {
    const address = this.addressRepository.create(addressData);
    return this.addressRepository.save(address);
  }

  //TODO:Update ───────────────────────────────────────────────────────────────

  public async update(id: string, addressData: Partial<Address>): Promise<Address> {
    let address = await this.addressRepository.findOneBy({ id });

    if (address) {
      Object.assign(address, addressData);
      const saved = await this.addressRepository.save(address);
      await this.cacheService.del(`${CACHE_PREFIX}:id:${id}`);
      return saved;
    }

    return this.create(addressData);
  }
}


  

  // // ─── Find By ID ───────────────────────────────────────────────────────────

  // public async findById(id: string): Promise<Address | null> {
  //   const key = `${CACHE_PREFIX}:id:${id}`;
  //   const cached = await this.cacheService.get<Address>(key);
  //   if (cached) return cached;

  //   const address = await this.addressRepository.findOneBy({ id });
  //   if (address) await this.cacheService.set(key, address, CACHE_TTL_ADDRESS);
  //   return address;
  // }

  // // ─── Delete (schedule) ────────────────────────────────────────────────────

  // public async deleteAddress(id: string): Promise<boolean> {
  //   const address = await this.addressRepository.findOne({ where: { id } });
  //   if (!address) throw new AppError(404, `Address with ID ${id} not found`);

  //   const sixMonthsFromNow = new Date();
  //   sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
  //   sixMonthsFromNow.setHours(0, 0, 0, 0);

  //   address.deletionScheduledAt = sixMonthsFromNow;
  //   await this.addressRepository.save(address);
  //   await this.cacheService.del(`${CACHE_PREFIX}:id:${id}`);

  //   return true;
  // }


