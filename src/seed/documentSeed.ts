import * as fs from 'fs';
import * as path from 'path';
import { In } from 'typeorm';
import { AppDataSource } from '../utils/data-source';


import logger from '../utils/logger';
import { DocumentDefinition } from '../documentDef/entity/documentdef.entity';
import { DocumentPermission } from '../employee/entity/permission.entity';

// Keys no longer used for permissions. Their definitions and permission rows are removed.
// 'vehicle-dispatch-register' stays an approval document type; only its permission key is retired.
const RETIRED_KEYS = ['vehicle-dispatch-register', 'Inventory', 'eod-report'];

/**
 * Syncs document_definitions with src/data/documentDefination.json: inserts new keys,
 * updates name / group / allowed actions of existing keys, removes retired keys.
 */
export async function seedDocumentDefDatabase() {
    try {
        logger.info('Syncing document definitions...');

        const documentRepo = AppDataSource.getRepository(DocumentDefinition);
        const permissionRepo = AppDataSource.getRepository(DocumentPermission);

        const filePath = path.join(__dirname, '..', 'data', 'documentDefination.json');
        const definitions = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        for (const def of definitions) {
            const existing = await documentRepo.findOne({ where: { uniqueKey: def.uniqueKey } });
            const row = existing ?? documentRepo.create({ uniqueKey: def.uniqueKey });
            row.name = def.name;
            row.documentType = def.documentType;
            row.allowedActions = def.allowedActions ?? [];
            await documentRepo.save(row);
        }

        const retired = await documentRepo.find({ where: { uniqueKey: In(RETIRED_KEYS) } });
        if (retired.length) {
            const ids = retired.map((d) => d.id);
            await permissionRepo
                .createQueryBuilder()
                .delete()
                .where('document_definition_id IN (:...ids)', { ids })
                .execute();
            await documentRepo.delete(ids);
            logger.info(`Removed retired document definitions: ${retired.map((d) => d.uniqueKey).join(', ')}`);
        }

        logger.info('Document definitions synced.');
    } catch (error) {
        logger.error('Error while seeding database:', error);
    }
}
