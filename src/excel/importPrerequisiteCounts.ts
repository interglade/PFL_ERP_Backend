/**
 * Counts each master's live records for the import-order check.
 *
 * Kept apart from `importPrerequisites.ts` so that the order itself can be
 * tested without loading every entity and the database connection.
 */

import { EntityTarget, ObjectLiteral } from 'typeorm';
import { AppDataSource } from '../utils/data-source';
import { ImportMaster, MasterRecordCounter } from './importPrerequisites';

import { UOM } from '../uom/entity/uom.entity';
import { CustomerType } from '../customer/customerType/entity/customerType.entity';
import { CustomerCategory } from '../customer/customerCategory/entity/customerCategory.entity';
import { VendorCategory } from '../vendor/vendorCategory/entity/vendorCategory.entity';
import { VendorSubcategory } from '../vendor/vendorSubcategory/entity/vendorSubcategory.entity';
import { ProductClassification } from '../product/productClassification/entity/product_classification.entity';
import { ProductCategory } from '../product/productCategory/entity/product_category.entity';
import { ProductSubcategory } from '../product/productSubcategory/entity/product_subcategory.entity';
import { PackingMaterial } from '../packingMaterial/entity/packingMaterial.entity';
import { Transporter } from '../transporter/entity/transporter.entity';
import { Drivers } from '../driver/entity/driver.entity';
import { Vehicle } from '../vehicle/entity/vehicle.entity';
import { Branches } from '../branch/entity/branches.entity';
import { OfficesData } from '../office/entity/offices.entity';
import { Customer } from '../customer/addcustomer/entity/customer.entity';
import { Product } from '../product/createproduct/entity/product.entity';
import { Vendor } from '../vendor/createVendor/entity/vendor.entity';
import { Farmer } from '../farmer/entity/farmer.entity';
import { User } from '../employee/entity/user.entity';

/** Tables behind each master. Locations live in two. */
const MASTER_ENTITIES: Record<ImportMaster, EntityTarget<ObjectLiteral>[]> = {
  uom: [UOM],
  'customer-type': [CustomerType],
  'customer-category': [CustomerCategory],
  'vendor-category': [VendorCategory],
  'product-classification': [ProductClassification],
  transporter: [Transporter],
  'vendor-subcategory': [VendorSubcategory],
  'product-category': [ProductCategory],
  'packaging-material': [PackingMaterial],
  driver: [Drivers],
  vehicle: [Vehicle],
  location: [Branches, OfficesData],
  customer: [Customer],
  'product-subcategory': [ProductSubcategory],
  product: [Product],
  vendor: [Vendor],
  farmer: [Farmer],
  user: [User],
};

/**
 * Live records only: soft-deleted rows (`deletedAt`) are excluded by TypeORM,
 * rows flagged `isDeleted` by the filter. Drafts count - a draft transporter
 * can still be named by a driver.
 */
export const countMasterRecords: MasterRecordCounter = async (master) => {
  const counts = await Promise.all(
    MASTER_ENTITIES[master].map((entity) =>
      AppDataSource.getRepository(entity).count({ where: { isDeleted: false } }),
    ),
  );
  return counts.reduce((total, count) => total + count, 0);
};
