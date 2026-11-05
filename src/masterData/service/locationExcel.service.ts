/**
 * Template, export and import of the Locations sheet - offices and branches
 * with their addresses (docs/master-data-excel-plan.md Phase 4).
 *
 * All or nothing, like the other small masters: every row is checked first,
 * and the file is saved in one transaction only when no row is wrong.
 */

import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { CacheService } from '../../global/cache.service';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import { AddressService } from '../../address/service/address.service';
import { Address } from '../../address/entity/address.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { OfficesData } from '../../office/entity/offices.entity';
import { GRN } from '../../grn/entity/grn.entity';
import {
  buildDataWorkbook,
  buildTemplateWorkbook,
  UploadedExport,
  uploadWorkbookToSpaces,
} from '../../excel/excelFile.service';
import { emptySummary, ExcelRow } from '../../excel/excelImport.service';
import {
  LOCATION_SHEET,
  LOCATION_TYPES,
  LocationPlan,
  LocationRecord,
  PincodePlace,
  pincodesToLookUp,
  planLocationImport,
} from '../excel/locations';
import type { MasterImportResult } from './masterDataExcel.service';

/** How long one pincode lookup may take before the row is left to the user. */
const PINCODE_LOOKUP_TIMEOUT_MS = 8000;

const toNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

@injectable()
export class LocationExcelService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
    @inject(TYPES.AuditLogService) private readonly auditLogService: AuditLogService,
    @inject(TYPES.AddressService) private readonly addressService: AddressService,
  ) {}

  /** Every live office and branch, flattened, in Location Type order then by name. */
  private async liveLocations(type?: string): Promise<LocationRecord[]> {
    const typeOrder = LOCATION_TYPES.map((locationType) => locationType.value);

    const [offices, branches] = await Promise.all([
      this.dataSource.getRepository(OfficesData).find({ relations: ['address'] }),
      this.dataSource.getRepository(Branches).find({ relations: ['address'] }),
    ]);

    const address = (record: { address?: Address | null }) =>
      record.address
        ? {
            id: record.address.id,
            address1: record.address.address1 ?? null,
            address2: record.address.address2 ?? null,
            location: record.address.location ?? null,
            city: record.address.city ?? null,
            state: record.address.state ?? null,
            pincode: record.address.pincode ?? null,
          }
        : null;

    const records: LocationRecord[] = [
      ...offices
        .filter((office) => !office.isDeleted)
        .map(
          (office): LocationRecord => ({
            id: office.id,
            kind: 'office',
            type: office.type,
            name: office.name,
            prefix: null,
            cFirstName: office.cFirstName ?? null,
            cMiddleName: office.cMiddleName ?? null,
            cLastName: office.cLastName ?? null,
            contactNumber: office.contactNumber ?? null,
            officeEmail: office.officeEmail ?? null,
            totalCapacity: null,
            currentCapacity: null,
            balanceCapacity: null,
            notes: office.notes ?? null,
            address: address(office),
          }),
        ),
      ...branches
        .filter((branch) => !branch.isDeleted)
        .map(
          (branch): LocationRecord => ({
            id: branch.id,
            kind: 'branch',
            type: branch.type,
            name: branch.name,
            prefix: branch.prefix ?? null,
            cFirstName: branch.cFirstName ?? null,
            cMiddleName: branch.cMiddleName ?? null,
            cLastName: branch.cLastName ?? null,
            contactNumber: branch.contactNumber ?? null,
            officeEmail: null,
            totalCapacity: toNumberOrNull(branch.totalCapacity),
            currentCapacity: toNumberOrNull(branch.currentCapacity),
            balanceCapacity: toNumberOrNull(branch.balanceCapacity),
            notes: branch.notes ?? null,
            address: address(branch),
          }),
        ),
    ];

    return records
      .filter((record) => !type || record.type === type)
      .sort(
        (a, b) =>
          typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || a.name.localeCompare(b.name),
      );
  }

  async buildTemplate(): Promise<UploadedExport> {
    return uploadWorkbookToSpaces(buildTemplateWorkbook(LOCATION_SHEET), 'Locations_Template', 0);
  }

  /** `type` narrows the export to one Location Type - the list page's own. */
  async exportAll(type?: string): Promise<UploadedExport> {
    if (type && !LOCATION_TYPES.some((locationType) => locationType.value === type)) {
      throw new AppError(400, `Unknown location type "${type}"`);
    }
    const records = await this.liveLocations(type);
    const label = LOCATION_TYPES.find((locationType) => locationType.value === type)?.label;
    return uploadWorkbookToSpaces(
      buildDataWorkbook(LOCATION_SHEET, records),
      label ? `Locations_${label}` : 'Locations',
      records.length,
    );
  }

  /** How many GRN numbers start with each branch's current prefix (`PREFIX-00001`). */
  private async prefixUseCount(): Promise<Map<string, number>> {
    const rows: { id: string; count: string }[] = await this.dataSource
      .getRepository(GRN)
      .createQueryBuilder('grn')
      .select('branch.id', 'id')
      .addSelect('COUNT(grn.id)', 'count')
      .innerJoin(Branches, 'branch', `grn.grnNo ILIKE branch.prefix || '-%'`)
      .where('branch.prefix IS NOT NULL')
      .groupBy('branch.id')
      .getRawMany();
    return new Map(rows.map((row) => [row.id, Number(row.count)]));
  }

  /**
   * City / State for the pincodes of rows that left them empty (D8). A lookup
   * that fails or times out just leaves the row to the user.
   */
  private async lookUpPincodes(rows: ExcelRow[]): Promise<Map<string, PincodePlace | null>> {
    const places = new Map<string, PincodePlace | null>();
    const pincodes = pincodesToLookUp(rows);

    // A handful at a time: the lookup is an external API, cached for a day.
    for (let start = 0; start < pincodes.length; start += 5) {
      await Promise.all(
        pincodes.slice(start, start + 5).map(async (pincode) => {
          try {
            const found = await Promise.race([
              this.addressService.fetchAddressByPincode(pincode),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('timed out')), PINCODE_LOOKUP_TIMEOUT_MS),
              ),
            ]);
            places.set(pincode, { city: found?.district ?? null, state: found?.state ?? null });
          } catch (error) {
            logger.warn(`Pincode lookup failed for ${pincode} during a Locations import`, { error });
            places.set(pincode, null);
          }
        }),
      );
    }

    return places;
  }

  async importRows(
    rows: ExcelRow[],
    options: { checkOnly: boolean; userId?: string; unknownColumns?: string[] },
  ): Promise<MasterImportResult> {
    const [existing, prefixUseCount, pincodes] = await Promise.all([
      this.liveLocations(),
      this.prefixUseCount(),
      this.lookUpPincodes(rows),
    ]);

    const plan = planLocationImport(rows, existing, { prefixUseCount, pincodes });

    const summary = emptySummary();
    summary.totalRows = rows.length;
    summary.unknownColumns = options.unknownColumns ?? [];
    summary.created = plan.creates.length;
    summary.updated = plan.updates.length;
    summary.failed = plan.failed;

    if (plan.failed.length) {
      throw new AppError(400, `Locations import: ${plan.failed.length} row(s) have errors.`, summary);
    }

    const counts =
      `${plan.creates.length} new, ${plan.updates.length} updated, ${plan.unchanged} unchanged` +
      (plan.filledFromPincode ? `; City / State filled from the pincode on ${plan.filledFromPincode} row(s)` : '');

    if (options.checkOnly) {
      return { message: `Locations file checked: ${counts}. Nothing has been saved yet.`, summary };
    }

    await this.dataSource.transaction((manager) => this.save(manager, plan));
    await this.afterSave(plan, options.userId);

    return { message: `Locations imported: ${counts}.`, summary };
  }

  private async save(manager: EntityManager, plan: LocationPlan): Promise<void> {
    for (const create of plan.creates) {
      const address = await manager.save(manager.create(Address, create.address));
      const entity = create.kind === 'office' ? OfficesData : Branches;
      await manager.save(
        manager.create(entity, { ...create.values, type: create.type, address } as any),
      );
    }

    for (const update of plan.updates) {
      const entity = update.record.kind === 'office' ? OfficesData : Branches;
      const changes: Record<string, unknown> = { ...update.changes };

      if (update.createAddress) {
        changes.address = await manager.save(manager.create(Address, update.addressChanges));
      } else if (Object.keys(update.addressChanges).length && update.record.address) {
        await manager.update(Address, update.record.address.id, update.addressChanges);
      }

      if (Object.keys(changes).length) {
        await manager.update(entity, update.record.id, changes as any);
      }
    }
  }

  /** Clears the office and branch caches and writes the audit entries the forms write. */
  private async afterSave(plan: LocationPlan, userId?: string): Promise<void> {
    try {
      await Promise.all([
        this.cacheService.invalidatePattern('office:*'),
        this.cacheService.invalidatePattern('branches:*'),
      ]);
    } catch (error) {
      logger.warn('Could not clear the location caches after an import', { error });
    }

    if (!userId) return;
    for (const update of plan.updates) {
      try {
        const { record } = update;
        if (Object.keys(update.changes).length) {
          await this.auditLogService.logChange(
            record.kind === 'office' ? 'Office' : 'Branches',
            record.id,
            record,
            update.changes,
            userId,
          );
        }
        if (Object.keys(update.addressChanges).length && record.address) {
          await this.auditLogService.logChange(
            'Address',
            record.address.id,
            record.address,
            update.addressChanges,
            userId,
          );
        }
      } catch (error) {
        logger.warn(`Could not audit the Locations import of ${update.record.id}`, { error });
      }
    }
  }
}
