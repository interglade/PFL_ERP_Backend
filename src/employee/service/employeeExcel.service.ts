/**
 * Template, export and import of the Users sheet (docs/user-import-plan.md).
 *
 * All or nothing: every row is checked first, and the file is saved in one
 * transaction only when no row is wrong. Permissions are never imported; new
 * users are saved Inactive with none, and the admin sets them from the form.
 */

import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { CacheService } from '../../global/cache.service';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { Address } from '../../address/entity/address.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { OfficesData } from '../../office/entity/offices.entity';
import { Company } from '../../company/entity/company.entity';
import { EmployeeStatus, User } from '../entity/user.entity';
import { DocumentPermission } from '../entity/permission.entity';
import { PERMISSION_TICKED_SQL } from '../employeePermissions';
import {
  buildDataWorkbook,
  buildTemplateWorkbook,
  UploadedExport,
  uploadWorkbookToSpaces,
} from '../../excel/excelFile.service';
import { emptySummary, ExcelRow } from '../../excel/excelImport.service';
import { formatDateCell } from '../../excel/excelValue';
import {
  AddressPlan,
  AddressValues,
  EMPLOYEE_SHEET,
  EmployeeAddress,
  EmployeePlan,
  EmployeePlanContext,
  EmployeeRecord,
  EmployeeValues,
  employeeWorkbookLists,
  LocationRef,
  NamedRef,
  planEmployeeImport,
} from '../excel/employees';
import { nextEmployeeIds, randomPassword } from '../employeeIds';
import type { MasterImportResult } from '../../masterData/service/masterDataExcel.service';

/** Same prefix as `UserService`, so the user list and forms see the import at once. */
const USER_CACHE_PREFIX = 'user';

const mapAddress = (address: Address | null | undefined): EmployeeAddress | null =>
  address
    ? {
        id: address.id,
        address1: address.address1 ?? undefined,
        address2: address.address2 ?? undefined,
        location: address.location ?? undefined,
        city: address.city ?? undefined,
        state: address.state ?? undefined,
        pincode: address.pincode ?? undefined,
      }
    : null;

@injectable()
export class EmployeeExcelService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
    @inject(TYPES.AuditLogService) private readonly auditLogService: AuditLogService,
  ) {}

  /** Live companies and locations, the names the sheet links to. */
  private async linkContext(): Promise<Pick<EmployeePlanContext, 'companies' | 'locations'>> {
    const [companies, branches, offices] = await Promise.all([
      this.dataSource.getRepository(Company).find(),
      this.dataSource.getRepository(Branches).find(),
      this.dataSource.getRepository(OfficesData).find(),
    ]);
    const live = <T extends { isDeleted?: boolean; name?: string | null }>(records: T[]) =>
      records.filter((record) => !record.isDeleted && record.name);
    return {
      companies: live(companies).map((company): NamedRef => ({ id: company.id, name: company.name })),
      locations: [
        ...live(branches).map((branch): LocationRef => ({ id: branch.id, name: branch.name, kind: 'branch' })),
        ...live(offices).map((office): LocationRef => ({ id: office.id, name: office.name, kind: 'office' })),
      ],
    };
  }

  /** Every live user, flattened, by Employee ID. */
  private async liveEmployees(): Promise<EmployeeRecord[]> {
    const users = await this.dataSource.getRepository(User).find({
      relations: [
        'residentialAddress',
        'permanentAddress',
        'companyName',
        'joiningLocation',
        'joiningOffice',
        'currentWorkLocation',
        'currentOfficeLocation',
        'accessLocation',
      ],
    });
    const live = users.filter((user) => !user.isDeleted);
    const withPermissions = await this.usersWithPermissions(live.map((user) => user.id));

    const location = (
      branch: Branches | null | undefined,
      office: OfficesData | null | undefined,
    ): LocationRef | null =>
      branch
        ? { id: branch.id, name: branch.name, kind: 'branch' }
        : office
          ? { id: office.id, name: office.name, kind: 'office' }
          : null;

    return live
      .map(
        (user): EmployeeRecord => ({
          id: user.id,
          employeeId: user.employeeId ?? null,
          firstName: user.firstName ?? null,
          middleName: user.middleName ?? null,
          lastName: user.lastName ?? null,
          username: user.username ?? null,
          primaryMobNo: user.primaryMobNo ?? null,
          secondaryMobNo: user.secondaryMobNo ?? null,
          primaryEmail: user.primaryEmail ?? null,
          secondaryEmail: user.secondaryEmail ?? null,
          designation: user.designation ?? null,
          cugNo: user.cugNo ?? null,
          workEmail: user.workEmail ?? null,
          joiningDate: formatDateCell(user.joiningDate) || null,
          department: Array.isArray(user.department) ? user.department.filter(Boolean) : [],
          roles: user.roles ?? [],
          status: user.status,
          isAddressSame: user.isAddressSame ?? null,
          residentialAddress: mapAddress(user.residentialAddress),
          permanentAddress: mapAddress(user.permanentAddress),
          companies: (user.companyName ?? []).map((company) => ({ id: company.id, name: company.name })),
          joining: location(user.joiningLocation, user.joiningOffice),
          current: location(user.currentWorkLocation, user.currentOfficeLocation),
          otherWorkLocationInput: user.otherWorkLocationInput ?? null,
          accessLocations: (user.accessLocation ?? []).map((branch) => ({ id: branch.id, name: branch.name })),
          permissionsSet: withPermissions.has(user.id),
        }),
      )
      .sort((a, b) => (a.employeeId ?? '').localeCompare(b.employeeId ?? ''));
  }

  /** Users with at least one permission tick. */
  private async usersWithPermissions(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows: { id: string }[] = await this.dataSource
      .getRepository(DocumentPermission)
      .createQueryBuilder('p')
      .select('DISTINCT p."employeeId"', 'id')
      .where('p."employeeId" IN (:...userIds)', { userIds })
      .andWhere(PERMISSION_TICKED_SQL('p'))
      .getRawMany();
    return new Set(rows.map((row) => row.id));
  }

  /** Users link to a company, which is added on the Company page, not imported. */
  async assertCompanyExists(): Promise<void> {
    const companies = await this.dataSource.getRepository(Company).count({ where: { isDeleted: false } });
    if (!companies) {
      throw new AppError(400, 'Users cannot be imported yet. Add a company on the Company page first.');
    }
  }

  async buildTemplate(): Promise<UploadedExport> {
    return uploadWorkbookToSpaces(
      buildTemplateWorkbook(EMPLOYEE_SHEET, employeeWorkbookLists(await this.linkContext())),
      'Users_Template',
      0,
    );
  }

  async exportAll(): Promise<UploadedExport> {
    const [records, context] = await Promise.all([this.liveEmployees(), this.linkContext()]);
    return uploadWorkbookToSpaces(
      buildDataWorkbook(EMPLOYEE_SHEET, records, employeeWorkbookLists(context)),
      'Users',
      records.length,
    );
  }

  async importRows(
    rows: ExcelRow[],
    options: { checkOnly: boolean; actor: { id: string; roles: string[] }; unknownColumns?: string[] },
  ): Promise<MasterImportResult> {
    const [existing, context] = await Promise.all([this.liveEmployees(), this.linkContext()]);
    const plan = planEmployeeImport(rows, existing, { ...context, actor: options.actor });

    const summary = emptySummary();
    summary.totalRows = rows.length;
    summary.unknownColumns = options.unknownColumns ?? [];
    summary.created = plan.creates.length;
    summary.updated = plan.updates.length;
    summary.failed = plan.failed;

    if (plan.failed.length) {
      throw new AppError(400, `Users import: ${plan.failed.length} row(s) have errors. Nothing was saved.`, summary);
    }

    const counts = `${plan.creates.length} new, ${plan.updates.length} updated, ${plan.unchanged} unchanged`;
    if (options.checkOnly) {
      return { message: `Users file checked: ${counts}. Nothing has been saved yet.`, summary };
    }

    await this.dataSource.transaction((manager) => this.save(manager, plan));
    await this.afterSave(plan, options.actor.id);

    const next = plan.creates.length
      ? ' New users are Inactive: set Permission Configuration on each, then activate them.'
      : '';
    return { message: `Users imported: ${counts}.${next}`, summary };
  }

  private async save(manager: EntityManager, plan: EmployeePlan): Promise<void> {
    // Deleted users count too, so an ID is never given out twice.
    const taken = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .withDeleted()
      .select('user.employeeId', 'employeeId')
      .getRawMany<{ employeeId: string | null }>();
    const employeeIds = nextEmployeeIds(taken.map((row) => row.employeeId), plan.creates.length);

    for (const [index, create] of plan.creates.entries()) {
      const residentialAddress = await manager.save(manager.create(Address, create.residential));
      const permanentAddress = await manager.save(manager.create(Address, create.permanent));
      const user = manager.create(User, {
        ...this.scalarValues(create.values),
        ...this.relationValues(create.values),
        isAddressSame: create.values.isAddressSame ?? false,
        residentialAddress,
        permanentAddress,
        employeeId: employeeIds[index],
        status: EmployeeStatus.INACTIVE,
        tempPlainPassword: randomPassword(),
      } as Partial<User>);
      // `save` on the entity runs @BeforeInsert, which hashes the password.
      await manager.save(user);
    }

    for (const update of plan.updates) {
      const user = await manager.findOneOrFail(User, {
        where: { id: update.record.id },
        relations: ['residentialAddress', 'permanentAddress', 'companyName', 'accessLocation'],
      });
      Object.assign(user, this.scalarValues(update.changes), this.relationValues(update.changes));
      if (update.changes.isAddressSame !== undefined) user.isAddressSame = update.changes.isAddressSame;
      user.residentialAddress = await this.saveAddress(manager, update.residential, user.residentialAddress);
      user.permanentAddress = await this.saveAddress(manager, update.permanent, user.permanentAddress);
      await manager.save(user);
    }
  }

  private async saveAddress(manager: EntityManager, plan: AddressPlan | null, current: Address): Promise<Address> {
    if (!plan) return current;
    if (plan.id) {
      await manager.update(Address, plan.id, plan.values);
      return current;
    }
    return manager.save(manager.create(Address, plan.values as AddressValues));
  }

  private scalarValues(values: EmployeeValues): Partial<User> {
    const scalars: Partial<User> = {};
    for (const property of [
      'firstName', 'middleName', 'lastName', 'username', 'primaryMobNo', 'secondaryMobNo',
      'primaryEmail', 'secondaryEmail', 'designation', 'cugNo', 'workEmail', 'otherWorkLocationInput',
    ] as const) {
      if (values[property] !== undefined) (scalars as any)[property] = values[property];
    }
    if (values.joiningDate) scalars.joiningDate = new Date(values.joiningDate);
    return scalars;
  }

  /** Links set as `{ id }` stubs; branch or office fields chosen by the location's kind, as the form does. */
  private relationValues(values: EmployeeValues): Partial<User> {
    const relations: Record<string, unknown> = {};
    if (values.department) relations.department = values.department;
    if (values.roles) relations.roles = values.roles;
    if (values.companyIds) relations.companyName = values.companyIds.map((id) => ({ id }));
    if (values.accessIds) relations.accessLocation = values.accessIds.map((id) => ({ id }));
    if (values.joining) {
      relations.joiningLocation = values.joining.kind === 'branch' ? { id: values.joining.id } : null;
      relations.joiningOffice = values.joining.kind === 'office' ? { id: values.joining.id } : null;
    }
    if (values.current !== undefined) {
      relations.currentWorkLocation = values.current?.kind === 'branch' ? { id: values.current.id } : null;
      relations.currentOfficeLocation = values.current?.kind === 'office' ? { id: values.current.id } : null;
    }
    return relations as Partial<User>;
  }

  /** Clears the user caches and writes an audit entry per updated user. Neither may fail the import. */
  private async afterSave(plan: EmployeePlan, actorId: string): Promise<void> {
    try {
      await this.cacheService.invalidatePattern(`${USER_CACHE_PREFIX}:*`);
    } catch (error) {
      logger.warn('Could not clear the user cache after a Users import', { error });
    }

    for (const update of plan.updates) {
      try {
        const changes: Record<string, unknown> = { ...update.changes };
        if (update.residential) changes.residentialAddress = update.residential.values;
        if (update.permanent) changes.permanentAddress = update.permanent.values;
        await this.auditLogService.logChange('User', update.record.id, update.record, changes, actorId);
      } catch (error) {
        logger.warn(`Could not audit the Users import of ${update.record.id}`, { error });
      }
    }
  }
}
