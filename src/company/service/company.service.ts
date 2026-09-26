import { inject, injectable } from 'inversify';
import { CompanyRepository } from '../repository/company.repository';
import { CacheService } from '../../global/cache.service';
import { TYPES } from '../../types';


const CACHE_PREFIX = 'company';
const CACHE_TTL = 600; // 10 minutes — company data rarely changes

@injectable()
export class CompanyService {
  constructor(
    @inject(TYPES.CompanyRepository)
    private readonly companyRepository: CompanyRepository,
    @inject(TYPES.CacheService)
    private readonly cacheService: CacheService,
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
