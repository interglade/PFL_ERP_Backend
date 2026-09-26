

import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../utils/data-source';
import { DocumentPermission } from '../employee/entity/permission.entity';
import { DocumentDefinition } from '../documentDef/entity/documentdef.entity';



type ActionType = 'create' | 'view' | 'edit' | 'delete' | 'download';

const actionToPermissionKey: Record<ActionType, keyof DocumentPermission> = {
  create: 'canCreate',
  view: 'canView',
  edit: 'canEdit',
  delete: 'canDelete',
  download: 'canDownload',
};

export const checkPermission = (documentKey: string, action: ActionType) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = res.locals.user;

      if (!user || !user.id) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const permissionRepo = AppDataSource.getRepository(DocumentPermission);
      const documentDefRepo = AppDataSource.getRepository(DocumentDefinition);

      const documentDefinition = await documentDefRepo.findOne({
        where: { uniqueKey: documentKey },
      });

      if (!documentDefinition) {
        return res.status(404).json({ message: 'Document definition not found' });
      }

      const permission = await permissionRepo.findOne({
        where: {
          employee: { id: user.id },
          documentDefinition: { id: documentDefinition.id },
        },
        relations: ['employee', 'documentDefinition'],
      });

      const permissionKey = actionToPermissionKey[action];
      if (!permission || !permission[permissionKey]) {
        return res.status(403).json({
          message: `You do not have permission to ${action} this document`,
        });
      }
      

      next();
    } catch (err) {
      //console.error('Permission check failed:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
};

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
