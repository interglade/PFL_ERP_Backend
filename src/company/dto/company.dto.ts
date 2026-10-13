import AppError from '../../utils/appError';

// ─────────────────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateCompanyDto {
  name?: string | null;
  officeAddress?: string | null;
  gstNo?: string | null;
  fassaiNo?: string | null;
  logo?: string | null;
}

export interface CreateBankDetailsDto {
  accountNo: string;
  bankName: string;
  branch?: string | null;
  ifscCode: string;
}

export interface UpdateBankDetailsDto extends Partial<CreateBankDetailsDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// Validation — returns a cleaned copy containing only whitelisted fields
// ─────────────────────────────────────────────────────────────────────────────

const GST_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NO_REGEX = /^\d{6,20}$/;

function pick<T extends object>(body: any, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of keys) {
    if (body[key] !== undefined) {
      const value = body[key];
      if (value !== null && typeof value !== 'string') {
        throw new AppError(400, `${String(key)} must be a string`);
      }
      out[key] = (typeof value === 'string' ? value.trim() : value) as any;
    }
  }
  return out;
}

export function validateUpdateCompany(body: any): UpdateCompanyDto {
  const dto = pick<UpdateCompanyDto>(body, ['name', 'officeAddress', 'gstNo', 'fassaiNo', 'logo']);

  if (Object.keys(dto).length === 0) {
    throw new AppError(400, 'No valid fields provided to update');
  }
  if (dto.name !== undefined && !dto.name) {
    throw new AppError(400, 'Company name cannot be empty');
  }
  if (dto.gstNo) {
    dto.gstNo = dto.gstNo.toUpperCase();
    if (!GST_REGEX.test(dto.gstNo)) throw new AppError(400, 'Invalid GST number');
  }
  return dto;
}

export function validateCreateBankDetails(body: any): CreateBankDetailsDto {
  const dto = pick<CreateBankDetailsDto>(body, ['accountNo', 'bankName', 'branch', 'ifscCode']);

  if (!dto.accountNo || !dto.bankName || !dto.ifscCode) {
    throw new AppError(400, 'accountNo, bankName and ifscCode are required');
  }
  assertBankFormats(dto);
  return dto as CreateBankDetailsDto;
}

export function validateUpdateBankDetails(body: any): UpdateBankDetailsDto {
  const dto = pick<UpdateBankDetailsDto>(body, ['accountNo', 'bankName', 'branch', 'ifscCode']);

  if (Object.keys(dto).length === 0) {
    throw new AppError(400, 'No valid fields provided to update');
  }
  if ((dto.accountNo !== undefined && !dto.accountNo) ||
      (dto.bankName !== undefined && !dto.bankName) ||
      (dto.ifscCode !== undefined && !dto.ifscCode)) {
    throw new AppError(400, 'accountNo, bankName and ifscCode cannot be empty');
  }
  assertBankFormats(dto);
  return dto;
}

function assertBankFormats(dto: UpdateBankDetailsDto): void {
  if (dto.ifscCode) {
    dto.ifscCode = dto.ifscCode.toUpperCase();
    if (!IFSC_REGEX.test(dto.ifscCode)) throw new AppError(400, 'Invalid IFSC code');
  }
  if (dto.accountNo && !ACCOUNT_NO_REGEX.test(dto.accountNo)) {
    throw new AppError(400, 'Account number must be 6-20 digits');
  }
}

// Shows only the last 4 digits, for logs
export function maskAccountNo(accountNo?: string | null): string {
  if (!accountNo) return '';
  return accountNo.length <= 4 ? accountNo : `${'X'.repeat(accountNo.length - 4)}${accountNo.slice(-4)}`;
}
