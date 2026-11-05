/**
 * Template, export and import for the small masters
 * (docs/master-data-excel-plan.md §5).
 *
 * An import is all or nothing: every row is checked first, and if any row is
 * wrong nothing is saved and every error is reported. Otherwise the whole file
 * is saved in one transaction. `checkOnly` runs the checks and saves nothing.
 */

import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { CacheService } from '../../global/cache.service';
import { AuditLogService } from '../../employeeActivity/service/auditLog.service';
import {
  buildDataWorkbook,
  buildTemplateWorkbook,
  deleteFromSpaces,
  UploadedExport,
  uploadWorkbookToSpaces,
} from '../../excel/excelFile.service';
import {
  emptySummary,
  ImportSummary,
  readUploadedSheet,
} from '../../excel/excelImport.service';
import { assertImportPrerequisites } from '../../excel/importPrerequisites';
import { countMasterRecords } from '../../excel/importPrerequisiteCounts';
import { NAMED_MASTERS, NamedMasterConfig, NamedRecord } from '../excel/namedMasters';
import { PlannedUpdate, planNamedMasterImport } from '../excel/namedMasterImport';
import { LookupIndex } from '../../excel/lookupIndex';
import { ExcelSheetDefinition, WorkbookLists } from '../../excel/excelColumn';
import { ImportMaster } from '../../excel/importPrerequisites';
import { LOCATION_SHEET } from '../excel/locations';
import { LocationExcelService } from './locationExcel.service';
import { EmployeeExcelService } from '../../employee/service/employeeExcel.service';
import { EMPLOYEE_SHEET } from '../../employee/excel/employees';

/** Offices and branches share one sheet with its own service (Phase 4). */
const LOCATION_MASTER = 'location';

/** Users (registrations without permissions) have their own service too (docs/user-import-plan.md). */
const USER_MASTER = 'user';

export interface MasterImportResult {
  message: string;
  summary: ImportSummary;
}

@injectable()
export class MasterDataExcelService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
    @inject(TYPES.AuditLogService) private readonly auditLogService: AuditLogService,
    @inject(TYPES.LocationExcelService) private readonly locationExcel: LocationExcelService,
    @inject(TYPES.EmployeeExcelService) private readonly employeeExcel: EmployeeExcelService,
  ) {}

  private configFor(master: string): NamedMasterConfig {
    const config = NAMED_MASTERS[master as keyof typeof NAMED_MASTERS];
    if (!config) {
      throw new AppError(404, `There is no Excel import for "${master}"`);
    }
    return config;
  }

  /**
   * Live records, by name, with their parent loaded. Rows flagged `isDeleted`
   * are left out like everywhere else.
   */
  private async liveRecords(config: NamedMasterConfig): Promise<NamedRecord[]> {
    const records = await this.dataSource.getRepository(config.entity).find({
      relations: [...(config.parent ? [config.parent.property] : []), ...config.relations],
      order: { [config.nameProperty]: 'ASC' } as any,
    });
    return records.filter((record) => !record.isDeleted);
  }

  /** The parent master's live records, ready to match names against. */
  private async parentIndex(config: NamedMasterConfig): Promise<LookupIndex<NamedRecord> | undefined> {
    const parent = config.parent;
    if (!parent) return undefined;
    const records = await this.dataSource.getRepository(parent.entity).find();
    return LookupIndex.fromRecords(
      records.filter((record: NamedRecord) => !record.isDeleted),
      { names: (record) => [parent.display(record), ...parent.names(record)] },
    );
  }

  /** Parent names for the dropdown in the template and the export. */
  private async workbookLists(config: NamedMasterConfig): Promise<WorkbookLists> {
    const parents = await this.parentIndex(config);
    return parents && config.parent ? { [config.parent.master]: parents.displayNames() } : {};
  }

  async buildTemplate(master: string): Promise<UploadedExport> {
    if (master === LOCATION_MASTER) return this.locationExcel.buildTemplate();
    if (master === USER_MASTER) return this.employeeExcel.buildTemplate();
    const config = this.configFor(master);
    return uploadWorkbookToSpaces(
      buildTemplateWorkbook(config.sheet, await this.workbookLists(config)),
      `${config.fileStem}_Template`,
      0,
    );
  }

  /** `type` narrows a Locations export to one Location Type; other masters ignore it. */
  async exportAll(master: string, options: { type?: string } = {}): Promise<UploadedExport> {
    if (master === LOCATION_MASTER) return this.locationExcel.exportAll(options.type);
    if (master === USER_MASTER) return this.employeeExcel.exportAll();
    const config = this.configFor(master);
    const records = await this.liveRecords(config);
    return uploadWorkbookToSpaces(
      buildDataWorkbook(config.sheet, records, await this.workbookLists(config)),
      config.fileStem,
      records.length,
    );
  }

  async importFile(
    master: string,
    fileUrl: string,
    options: { checkOnly: boolean; userId?: string; actor?: { id: string; roles: string[] } },
  ): Promise<MasterImportResult> {
    const isLocation = master === LOCATION_MASTER;
    const isUser = master === USER_MASTER;
    const config = isLocation || isUser ? null : this.configFor(master);
    const sheetDef: ExcelSheetDefinition<any> = config?.sheet ?? (isUser ? EMPLOYEE_SHEET : LOCATION_SHEET);
    const label = config?.label ?? (isUser ? 'Users' : 'Locations');
    const importMaster: ImportMaster = config?.master ?? (isUser ? USER_MASTER : LOCATION_MASTER);

    try {
      // An optional parent (a packaging material's Reference UoM) only has to
      // be imported first when the file names one.
      const optionalParent = config?.parent && !config.parent.required ? config.parent : null;
      if (!optionalParent) await assertImportPrerequisites(importMaster, countMasterRecords);
      if (isUser) await this.employeeExcel.assertCompanyExists();

      const sheet = await readUploadedSheet(fileUrl, sheetDef);
      if (optionalParent && sheet.rows.some((row) => row.text(optionalParent.header))) {
        await assertImportPrerequisites(importMaster, countMasterRecords);
      }
      if (sheet.missingColumns.length) {
        throw new AppError(
          400,
          `The file is missing required column(s): ${sheet.missingColumns.join(', ')}. ` +
            `Download the ${label} template to see the expected columns.`,
        );
      }
      if (!sheet.rows.length) {
        throw new AppError(400, `The file has no ${label} rows to import.`);
      }

      if (isUser) {
        if (!options.actor) throw new AppError(401, 'Log in again to import users');
        return await this.employeeExcel.importRows(sheet.rows, {
          checkOnly: options.checkOnly,
          actor: options.actor,
          unknownColumns: sheet.unknownColumns,
        });
      }

      if (!config) {
        return await this.locationExcel.importRows(sheet.rows, {
          ...options,
          unknownColumns: sheet.unknownColumns,
        });
      }

      const existing = await this.liveRecords(config);
      const plan = planNamedMasterImport(config, sheet.rows, existing, await this.parentIndex(config));

      const summary = emptySummary();
      summary.totalRows = sheet.rows.length;
      summary.unknownColumns = sheet.unknownColumns;
      summary.created = plan.creates.length;
      summary.updated = plan.updates.length;
      summary.failed = plan.failed;

      if (plan.failed.length) {
        throw new AppError(
          400,
          `${config.label} import: ${plan.failed.length} row(s) have errors.`,
          summary,
        );
      }

      const counts =
        `${plan.creates.length} new, ${plan.updates.length} updated, ` +
        `${plan.unchanged} unchanged`;

      if (options.checkOnly) {
        return {
          message: `${config.label} file checked: ${counts}. Nothing has been saved yet.`,
          summary,
        };
      }

      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(config.entity);
        const parentProperty = config.parent?.property;
        for (const create of plan.creates) {
          await repository.save(
            repository.create({
              ...create.values,
              ...(parentProperty && create.parentId ? { [parentProperty]: { id: create.parentId } } : {}),
            } as any),
          );
        }
        for (const update of plan.updates) {
          await repository.update(update.record.id, {
            ...update.changes,
            ...(parentProperty && update.parentChange
              ? { [parentProperty]: { id: update.parentChange.id } }
              : {}),
          } as any);
        }
      });

      await this.afterSave(config, plan.updates, options.userId);

      return { message: `${config.label} imported: ${counts}.`, summary };
    } finally {
      // The upload is a staging copy: remove it whatever happened.
      await deleteFromSpaces(fileUrl);
    }
  }

  /**
   * Clears the master's cached lists and records and writes the same audit
   * entries the edit form does. Neither may fail the import - it is saved.
   */
  private async afterSave(
    config: NamedMasterConfig,
    updates: PlannedUpdate<NamedRecord>[],
    userId?: string,
  ): Promise<void> {
    try {
      await this.cacheService.invalidatePattern(`${config.cachePrefix}:*`);
    } catch (error) {
      logger.warn(`Could not clear the ${config.label} cache after an import`, { error });
    }

    if (!userId) return;
    for (const update of updates) {
      try {
        // The parent is logged by name, the way a user would recognise it.
        const parentProperty = config.parent?.property ?? 'parent';
        await this.auditLogService.logChange(
          config.auditName,
          update.record.id,
          { ...update.record, [parentProperty]: update.parentChange?.from ?? null },
          {
            ...update.changes,
            ...(update.parentChange ? { [parentProperty]: update.parentChange.to } : {}),
          },
          userId,
        );
      } catch (error) {
        logger.warn(`Could not audit the ${config.label} import of ${update.record.id}`, {
          error,
        });
      }
    }
  }
}
