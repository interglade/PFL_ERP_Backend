
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../utils/data-source';


import logger from '../utils/logger';
import { DocumentDefinition } from '../documentDef/entity/documentdef.entity';

export async function seedDocumentDefDatabase() {
    try {
        logger.info('Checking for existing documentDefination data...');

        const documentRepo = AppDataSource.getRepository(DocumentDefinition);
       

        logger.info('Seeding database with fresh data...');

        // Read JSON file
        const filePath = path.join(__dirname, '..', 'data', 'documentDefination.json');
       const jsonData = fs.readFileSync(filePath, 'utf-8');
        const companies = JSON.parse(jsonData);

        for (const companyData of companies) {
            const existing = await documentRepo.findOne({ where: { uniqueKey: companyData.uniqueKey } });
            if (existing) {
                continue; // skip if already exists
            }

            const company = documentRepo.create({
                uniqueKey: companyData.uniqueKey,
                name: companyData.name,
                documentType: companyData.documentType,
               
            });

            await documentRepo.save(company);

            
        }

        logger.info('Seeding completed successfully!');
    } catch (error) {
        logger.error('Error while seeding database:', error);
    }
}


