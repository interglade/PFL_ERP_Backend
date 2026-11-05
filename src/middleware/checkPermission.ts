import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../utils/data-source';
import { DocumentPermission } from '../employee/entity/permission.entity';
import { DocumentDefinition } from '../documentDef/entity/documentdef.entity';
import { isSuperAdmin } from '../utils/roles';
import { Role } from '../employee/entity/user.entity';
import logger from '../utils/logger';



export type ActionType = 'create' | 'view' | 'edit' | 'delete' | 'download' | 'export';

/** A permission key, or a function that works it out from the request (e.g. the dispatch type). */
export type PermissionKeyResolver =
  | string
  | ((req: Request, res: Response) => string | null | Promise<string | null>);

const actionToPermissionKey: Record<ActionType, keyof DocumentPermission> = {
  create: 'canCreate',
  view: 'canView',
  edit: 'canEdit',
  delete: 'canDelete',
  download: 'canDownload',
  export: 'canExport',
};

/**
 * ENFORCE_PERMISSIONS=log only logs refusals and lets the request through (for a trial period
 * after granting permissions). Anything else, or unset, enforces.
 */
const enforcing = () => process.env.ENFORCE_PERMISSIONS !== 'log';

interface LoadedPermissions {
  definitions: Map<string, DocumentDefinition>;
  rows: Map<string, DocumentPermission>;
}

/** The user's permission rows and the key definitions, loaded once per request. */
async function loadPermissions(res: Response): Promise<LoadedPermissions> {
  if (res.locals.permissionCache) return res.locals.permissionCache as LoadedPermissions;

  const [definitionList, rowList] = await Promise.all([
    AppDataSource.getRepository(DocumentDefinition).find(),
    AppDataSource.getRepository(DocumentPermission).find({
      where: { employee: { id: res.locals.user.id } },
      relations: ['documentDefinition'],
    }),
  ]);

  const loaded: LoadedPermissions = {
    definitions: new Map(definitionList.map((d) => [d.uniqueKey, d])),
    rows: new Map(
      rowList.filter((r) => r.documentDefinition).map((r) => [r.documentDefinition.uniqueKey, r]),
    ),
  };
  res.locals.permissionCache = loaded;
  return loaded;
}

/**
 * Whether the logged-in user may perform `action` on `documentKey`.
 *  - the key must offer the action (allowedActions)
 *  - admins (incl. Super Admins) may view, download and export everything; admin lists already show all data
 *  - a Super Admin may delete everywhere
 *  - everyone else needs the tick on their permission row
 */
export async function hasPermission(res: Response, documentKey: string, action: ActionType): Promise<boolean> {
  const user = res.locals.user;
  if (!user?.id) return false;

  const { definitions, rows } = await loadPermissions(res);
  const definition = definitions.get(documentKey);
  if (!definition) return false;
  if (definition.allowedActions?.length && !definition.allowedActions.includes(action)) return false;

  const roles: string[] = Array.isArray(user.roles) ? user.roles : [];
  if ((action === 'view' || action === 'download' || action === 'export') && roles.includes(Role.ADMIN)) {
    return true;
  }
  if (action === 'delete' && isSuperAdmin(user)) return true;

  const row = rows.get(documentKey);
  return !!row && !!row[actionToPermissionKey[action]];
}

function refuse(req: Request, res: Response, next: NextFunction, what: string) {
  logger.warn(`Permission refused: user ${res.locals.user?.id} needs ${what} for ${req.method} ${req.originalUrl}`);
  if (!enforcing()) return next();
  return res.status(403).json({ message: `You do not have permission to ${what}` });
}

export const checkPermission = (documentKey: PermissionKeyResolver, action: ActionType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!res.locals.user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const key = typeof documentKey === 'function' ? await documentKey(req, res) : documentKey;
      if (!key) {
        return res.status(400).json({ message: 'Unknown document type' });
      }

      if (await hasPermission(res, key, action)) return next();
      return refuse(req, res, next, `${action} ${key}`);
    } catch (err) {
      logger.error('Permission check failed', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
};

/**
 * Passes when ANY of the (key, action) pairs is allowed. For endpoints shared by several screens,
 * e.g. available batches read by the DC, Second Sale, Dump and RTV forms.
 */
export const checkAnyPermission = (...pairs: [string, ActionType][]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!res.locals.user?.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      for (const [key, action] of pairs) {
        if (await hasPermission(res, key, action)) return next();
      }
      return refuse(req, res, next, pairs.map(([k, a]) => `${a} ${k}`).join(' or '));
    } catch (err) {
      logger.error('Permission check failed', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
};
