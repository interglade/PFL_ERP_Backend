/**
 * Runs a document Excel export for a controller: works out which documents the
 * user may export, then streams the workbook to the response.
 *
 * Access control is inherited, not re-implemented. The set of documents comes
 * from the module's own list service, called with the user's id and the same
 * search/filter/sort options as the list endpoint - so an export can only ever
 * contain what that user sees in the list (creator, verifier, approver and
 * finalizer visibility rules included), just without pagination. The filters go
 * through the same `applyDocumentListFilters` as the list endpoint. The full data
 * for those ids is then loaded chunk by chunk from the export definition.
 */

import { NextFunction, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import logger from '../../utils/logger';
import { ControllerLogger } from '../../utils/controllerLogger';
import { PaginationOptions } from '../../utils/pagination';
import { ExportDefinition, ExportRef } from './exportTypes';
import { ExportAbortedError, streamExportWorkbook } from './excelStreamWriter';
import { EXPORT_ALL_ROWS, ExportListConfig, buildExportListOptions } from './exportRequest';
import { exportFileName } from './exportValue';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ListRow = { id?: string | null; documentId?: string | null; kind?: string };

export interface DocumentExportRequest {
  /** Used in log lines, e.g. `RFPA`. */
  entityName: string;
  definition: ExportDefinition;
  /**
   * Mirrors the list endpoint's query parsing. Omit only when `fetchList` builds its
   * own per-type options from the request (the combined vouchers export).
   */
  list?: ExportListConfig;
  /** The module's list service method, bound to its service. */
  fetchList: (queryOptions: PaginationOptions, userId: string) => Promise<{ data: ListRow[] } | null | undefined>;
}

@injectable()
export class DocumentExportService {
  constructor(@inject(TYPES.DataSource) private readonly dataSource: DataSource) {}

  /** Collapses list rows to refs, keeping list order and dropping duplicates. */
  static toRefs(rows: ListRow[] | null | undefined): ExportRef[] {
    const seen = new Set<string>();
    const refs: ExportRef[] = [];
    for (const row of rows ?? []) {
      if (!row?.id) continue;
      const key = `${row.kind ?? ''}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ id: row.id, documentId: row.documentId ?? null, ...(row.kind ? { kind: row.kind } : {}) });
    }
    return refs;
  }

  async export(req: Request, res: Response, next: NextFunction, request: DocumentExportRequest): Promise<void> {
    const operation = `${request.entityName} Excel Export`;
    const userId: string | undefined = res.locals.user?.id;

    let refs: ExportRef[];
    try {
      if (!userId) {
        throw new AppError(401, 'User not authenticated');
      }

      // Same list options, filters and authorisation as the module's Get All - minus pagination.
      const queryOptions = request.list ? buildExportListOptions(req.query, request.list) : { page: 1, limit: EXPORT_ALL_ROWS };
      const listResult = await request.fetchList(queryOptions, userId);
      refs = DocumentExportService.toRefs(listResult?.data);

      if (!refs.length) {
        ControllerLogger.logOperationFailed('Export', request.entityName, 'No records found for the given filters', req, res);
        throw new AppError(404, 'No records found for the given filters');
      }
    } catch (error) {
      if (!(error instanceof AppError)) ControllerLogger.logError(operation, error, req, res);
      return next(error);
    }

    const fileName = exportFileName(request.definition.fileStem);
    res.status(200);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    // Lets a browser client on another origin read the file name and count.
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Record-Count');
    // Business data: never let a proxy or the browser cache keep a copy.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Export-Record-Count', String(refs.length));

    let aborted = false;
    const onClose = () => {
      if (!res.writableFinished) aborted = true;
    };
    res.on('close', onClose);

    try {
      const { rowsPerSheet } = await streamExportWorkbook(request.definition, {
        manager: this.dataSource.manager,
        refs,
        output: res,
        isAborted: () => aborted,
      });
      ControllerLogger.logList(operation, req, res);
      logger.info(`${operation} completed`, { userId, records: refs.length, rowsPerSheet });
    } catch (error) {
      if (error instanceof ExportAbortedError) {
        logger.warn(`${operation} aborted by client`, { userId, records: refs.length });
      } else {
        ControllerLogger.logError(operation, error, req, res);
      }
      // Headers and part of the file are already sent, so a JSON error is no longer
      // possible. Destroying the socket makes the download fail visibly instead of
      // leaving the user with a truncated, corrupt .xlsx.
      if (!res.destroyed) res.destroy(error as Error);
    } finally {
      res.off('close', onClose);
    }
  }
}
