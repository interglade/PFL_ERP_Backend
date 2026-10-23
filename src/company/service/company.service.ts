import { inject, injectable } from 'inversify';
import { CompanyRepository } from '../repository/company.repository';
import { CacheService } from '../../global/cache.service';
import { TYPES } from '../../types';
import { DataSource } from 'typeorm';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { Company } from '../entity/company.entity';
import { BankDetails } from '../entity/bankDetailsCompany.entity';
import {
  CreateBankDetailsDto,
  UpdateBankDetailsDto,
  UpdateCompanyDto,
  maskAccountNo,
} from '../dto/company.dto';


const CACHE_PREFIX = 'company';
const CACHE_TTL = 600; // 10 minutes — company data rarely changes

@injectable()
export class CompanyService {
  constructor(
    @inject(TYPES.CompanyRepository)
    private readonly companyRepository: CompanyRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
  ) {}

  // ─── Cache Helpers ────────────────────────────────────────────────────────

  async invalidateCompanyCache(id?: string): Promise<void> {
    const tasks: Promise<any>[] = [
      this.cacheService.del(`${CACHE_PREFIX}:all`),
      this.cacheService.del(`${CACHE_PREFIX}:update`),
      this.cacheService.del(`${CACHE_PREFIX}:partial`),
    ];
    if (id) tasks.push(this.cacheService.del(`${CACHE_PREFIX}:id:${id}`));
    await Promise.all(tasks);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async createCompany(companyData: any): Promise<any> {
    const company = this.companyRepository.create(companyData);
    const saved = await this.companyRepository.save(company);
    await this.invalidateCompanyCache();
    return saved;
  }

  // ─── Update Company (admin only — enforced in controller) ─────────────────

  async updateCompany(id: string, dto: UpdateCompanyDto, updatedBy: string): Promise<any> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Company);
      const company = await repo.findOne({ where: { id } });
      if (!company) throw new AppError(404, 'Company not found');

      const before = { ...company };
      Object.assign(company, dto);
      await repo.save(company);

      logger.info(
        `Company ${id} updated by ${updatedBy}. before=${JSON.stringify({
          name: before.name, officeAddress: before.officeAddress, gstNo: before.gstNo,
          fassaiNo: before.fassaiNo, logo: before.logo,
        })} after=${JSON.stringify(dto)}`,
      );
    });

    await this.invalidateCompanyCache(id);
    return this.getCompanyById(id);
  }

  // ─── Bank Details (admin only — enforced in controller) ───────────────────

  async addBankDetail(companyId: string, dto: CreateBankDetailsDto, updatedBy: string): Promise<any> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const company = await manager.getRepository(Company).findOne({ where: { id: companyId } });
      if (!company) throw new AppError(404, 'Company not found');

      const bankRepo = manager.getRepository(BankDetails);
      const bank = await bankRepo.save(
        bankRepo.create({
          accountNo: dto.accountNo,
          bankName: dto.bankName,
          branch: dto.branch ?? undefined,
          ifscCode: dto.ifscCode,
          company,
        }),
      );

      logger.info(
        `Bank ${bank.id} added to company ${companyId} by ${updatedBy}. ` +
        `account=${maskAccountNo(dto.accountNo)} ifsc=${dto.ifscCode}`,
      );
      return bank;
    });

    await this.invalidateCompanyCache(companyId);
    return { id: saved.id, ...dto };
  }

  async updateBankDetail(bankId: string, dto: UpdateBankDetailsDto, updatedBy: string): Promise<any> {
    const { saved, companyId } = await this.dataSource.transaction(async (manager) => {
      const bankRepo = manager.getRepository(BankDetails);
      const bank = await bankRepo.findOne({ where: { id: bankId }, relations: ['company'] });
      if (!bank) throw new AppError(404, 'Bank details not found');

      const before = { ...bank };
      Object.assign(bank, dto);
      const saved = await bankRepo.save(bank);

      logger.info(
        `Bank ${bankId} updated by ${updatedBy}. ` +
        `before=${JSON.stringify({ ...before, company: undefined, accountNo: maskAccountNo(before.accountNo) })} ` +
        `after=${JSON.stringify({ ...dto, accountNo: maskAccountNo(dto.accountNo) })}`,
      );
      return { saved, companyId: bank.company?.id };
    });

    await this.invalidateCompanyCache(companyId);
    const { company, ...rest } = saved as any;
    return rest;
  }

  async deleteBankDetail(bankId: string, updatedBy: string): Promise<void> {
    const companyId = await this.dataSource.transaction(async (manager) => {
      const bankRepo = manager.getRepository(BankDetails);
      const bank = await bankRepo.findOne({ where: { id: bankId }, relations: ['company'] });
      if (!bank) throw new AppError(404, 'Bank details not found');

      const remaining = await bankRepo.count({ where: { company: { id: bank.company.id } } });
      if (remaining <= 1) {
        throw new AppError(400, 'A company must keep at least one bank account');
      }

      await bankRepo.softDelete(bankId);
      logger.info(
        `Bank ${bankId} (account=${maskAccountNo(bank.accountNo)}) deleted by ${updatedBy}`,
      );
      return bank.company.id;
    });

    await this.invalidateCompanyCache(companyId);
  }

  // ─── Get By ID ────────────────────────────────────────────────────────────

  async getCompanyById(id: string): Promise<any> {
    const key = `${CACHE_PREFIX}:id:${id}`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const company = await this.companyRepository.findOne({
      where: { id },
      relations: ['bankDetails'],
    });

    if (company) await this.cacheService.set(key, company, CACHE_TTL);
    return company;
  }

  // ─── Get All (view) ───────────────────────────────────────────────────────

  async getAllCompanies(): Promise<any> {
    const key = `${CACHE_PREFIX}:all`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const result = await this.companyRepository.find({
      relations: ['bankDetails'],
    });

    const mapped = result.map((company) => ({
      id: company.id,
      name: company.name,
      gstNo: company.gstNo,
      officeAddress: company.officeAddress,
      fassaiNo: company.fassaiNo,
      logo: company.logo,
      bankDetails: company.bankDetails?.map((bank) => ({
        id: bank.id,
        bankName: bank.bankName,
        accountNo: bank.accountNo,
        ifscCode: bank.ifscCode,
        branch: bank.branch,
      })),
    }));

    await this.cacheService.set(key, mapped, CACHE_TTL);
    return mapped;
  }

  // ─── Get All (for update form) ────────────────────────────────────────────

  async getAllforupdateCompanies(): Promise<any> {
    const key = `${CACHE_PREFIX}:update`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const result = await this.companyRepository.find({ relations: ['bankDetails'] });
    await this.cacheService.set(key, result, CACHE_TTL);
    return result;
  }

  // ─── Get Partial (id + name only) ────────────────────────────────────────

  async getPartialCompanyDeatils(): Promise<any> {
    const key = `${CACHE_PREFIX}:partial`;
    const cached = await this.cacheService.get<any>(key);
    if (cached) return cached;

    const result = await this.companyRepository.find({
      select: ['id', 'name'],
    });

    await this.cacheService.set(key, result, CACHE_TTL);
    return result;
  }
}
