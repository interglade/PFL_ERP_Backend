
// import { AppDataSource } from "./data-source";
// import { Farmer } from '../entities/farmer.entity';
// import { Vendor } from '../entities/vendor.entity';
// import { Customer } from '../entities/customer.entity';


// function formatDateToYYYYMMDD(date: Date): string {
//   const year = date.getFullYear();
//   const month = String(date.getMonth() + 1).padStart(2, '0');
//   const day = String(date.getDate()).padStart(2, '0');

//   return `${year}${month}${day}`;
// }

// type EntityType = 'farmer' | 'vendor' | 'customer';


// const entityTypeMap = {
//   farmer: { repository: AppDataSource.getRepository(Farmer), abbreviation: 'FARM', codeField: 'farmerCode' },
//   vendor: { repository: AppDataSource.getRepository(Vendor), abbreviation: 'VEND', codeField: 'vendorCode' },
//   customer: { repository: AppDataSource.getRepository(Customer), abbreviation: 'CUST', codeField: 'customerCode' },
// };


// export async function generateIncrementalCode(entityType: EntityType, entity?: { createdAt?: Date }): Promise<string> {
//   const mapping = entityTypeMap[entityType];
//   console.log('Mapping:', mapping);
  
//   if (!mapping) {
//     throw new Error('Invalid entity type');
//   }
//   if (!mapping.repository) throw new Error('Repository is undefined');
//   const { repository, abbreviation: entityAbbreviation, codeField } = mapping;

//   console.log('entityType:', entityType);

 
//   const result = await AppDataSource.query(`SELECT nextval('code_sequence_${entityType}') as nextId`);
//   console.log('Sequence query result:', result);
//   let nextId = result[0].nextid ?? result[0].nextId;

//   if (typeof nextId === 'undefined') {
//   throw new Error(`Failed to get nextId from sequence code_sequence_${entityType}.`);
// }

//   const entityCreationDate = (entity && entity.createdAt) ? entity.createdAt : new Date();
//   const dateOfCreation = formatDateToYYYYMMDD(entityCreationDate);

//   let code: string = '';
//   let exists = true;


//   while (exists) {
//     code = `${entityAbbreviation}${dateOfCreation}${nextId.toString().padStart(4, '0')}`;
//     exists = (await repository.findOne({ where: { [codeField]: code } })) !== null;
//     if (exists) {
//       nextId++;
//     }
//   }

//   return code;
// }

//Code by shri 
import { Customer } from "../customer/addcustomer/entity/customer.entity";
import { Farmer } from "../farmer/entity/farmer.entity";
import { Vendor } from "../vendor/createVendor/entity/vendor.entity";
import { AppDataSource } from "./data-source";


// function formatDateToYYYYMMDD(date: Date): string {
//   const year = date.getFullYear();
//   const month = String(date.getMonth() + 1).padStart(2, '0');
//   const day = String(date.getDate()).padStart(2, '0');
//   return `${year}${month}${day}`;
// }

// type EntityType = 'farmer' | 'vendor' | 'customer';

// export async function generateIncrementalCode(
//   entityType: EntityType,
//   entity?: { createdAt?: Date }
// ): Promise<string> {
//   let repository, entityAbbreviation, codeField;

//   if (entityType === 'farmer') {
//     repository = AppDataSource.getRepository(Farmer);
//     entityAbbreviation = 'FARM';
//     codeField = 'farmerCode';
//   } else if (entityType === 'vendor') {
//     repository = AppDataSource.getRepository(Vendor);
//     entityAbbreviation = 'VEND';
//     codeField = 'vendorCode';
//   } else if (entityType === 'customer') {
//     repository = AppDataSource.getRepository(Customer);
//     entityAbbreviation = 'CUST';
//     codeField = 'customerCode';
//   } else {
//     throw new Error('Invalid entity type');
//   }

//   if (!repository) throw new Error('Repository is undefined');

//   let nextId: number;

//   try {
//     const result = await AppDataSource.query(`SELECT nextval('code_sequence_${entityType}') as nextId`);
//     nextId = result[0].nextid ?? result[0].nextId;
//   } catch (err: any) {
//     if (err.code === '42P01') {
//       // Sequence doesn't exist, create it
//       await AppDataSource.query(`CREATE SEQUENCE code_sequence_${entityType} START 1`);
//       const result = await AppDataSource.query(`SELECT nextval('code_sequence_${entityType}') as nextId`);
//       nextId = result[0].nextid ?? result[0].nextId;
//     } else {
//       throw err;
//     }
//   }

//   const entityCreationDate = (entity && entity.createdAt) ? entity.createdAt : new Date();
//   const dateOfCreation = formatDateToYYYYMMDD(entityCreationDate);

//   let code: string = '';
//   let exists = true;

//   while (exists) {
//     code = `${entityAbbreviation}${dateOfCreation}${nextId.toString().padStart(4, '0')}`;
//     exists = (await repository.findOne({ where: { [codeField]: code } })) !== null;
//     if (exists) {
//       nextId++;
//     }
//   }

//   return code;
// }


function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

type EntityType = 'farmer' | 'vendor' | 'customer';

export async function generateIncrementalCode(
  entityType: EntityType,
  entity?: { createdAt?: Date }
): Promise<string> {
  let repository, entityAbbreviation, codeField;

  if (entityType === 'farmer') {
    repository = AppDataSource.getRepository(Farmer);
    entityAbbreviation = 'FARM';
    codeField = 'farmerCode';
  } else if (entityType === 'vendor') {
    repository = AppDataSource.getRepository(Vendor);
    entityAbbreviation = 'VEND';
    codeField = 'vendorCode';
  } else if (entityType === 'customer') {
    repository = AppDataSource.getRepository(Customer);
    entityAbbreviation = 'CUST';
    codeField = 'customerCode';
  } else {
    throw new Error('Invalid entity type');
  }

  if (!repository) throw new Error('Repository is undefined');

  const entityCreationDate = (entity && entity.createdAt) ? entity.createdAt : new Date();
  const dateOfCreation = formatDateToYYYYMMDD(entityCreationDate);

  const prefix = `${entityAbbreviation}${dateOfCreation}`;

  // Get the last created code with the same prefix
  const lastRecord = await repository
    .createQueryBuilder('entity')
    .where(`${codeField} LIKE :prefix`, { prefix: `${prefix}%` })
    .orderBy(`${codeField}`, 'DESC')
    .getOne();

  let nextId = 1;
  if (lastRecord) {
    const lastCode = (lastRecord as Record<string, any>)[codeField];
    const lastNumber = parseInt(lastCode.slice(-4)); // Get last 4 digits
    nextId = lastNumber + 1;
  }

  const code = `${prefix}${nextId.toString().padStart(4, '0')}`;
  return code;
}
