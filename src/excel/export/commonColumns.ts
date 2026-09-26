/**
 * Column blocks that recur across document exports: parties, locations,
 * products and audit fields. Each takes an accessor to the related entity, so a
 * definition reads as a list of what it exports rather than repeated boilerplate.
 */

import { ExportColumn } from './exportTypes';
import { addressText, farmerName, personName } from './exportValue';

type Get<R> = (row: R) => any;

export function userColumns<R>(label: string, get: Get<R>, maps: string): ExportColumn<R>[] {
  return [
    { header: label, maps: `${maps} -> users.firstName/middleName/lastName`, get: (r) => personName(get(r)) },
    { header: `${label} Employee ID`, maps: `${maps} -> users.employeeId`, get: (r) => get(r)?.employeeId },
  ];
}

export function companyColumns<R>(get: Get<R>, maps = 'companyName -> company'): ExportColumn<R>[] {
  return [
    { header: 'Company', maps: `${maps}.name`, get: (r) => get(r)?.name },
    { header: 'Company GST No', maps: `${maps}.gstNo`, get: (r) => get(r)?.gstNo },
  ];
}

export function branchColumn<R>(label: string, get: Get<R>, maps: string): ExportColumn<R> {
  return { header: label, maps: `${maps} -> branches.name`, get: (r) => get(r)?.name };
}

export function vendorColumns<R>(get: Get<R>, maps = 'selectedVendor -> vendor'): ExportColumn<R>[] {
  return [
    { header: 'Vendor ID', maps: `${maps}.id`, get: (r) => get(r)?.id },
    { header: 'Vendor Name', maps: `${maps}.companyName`, get: (r) => get(r)?.companyName },
    { header: 'Vendor Code', maps: `${maps}.vendorCode`, get: (r) => get(r)?.vendorCode },
    { header: 'Vendor GSTN', maps: `${maps}.gstn`, get: (r) => get(r)?.gstn },
    { header: 'Vendor Contact No', maps: `${maps}.officeContactNo`, get: (r) => get(r)?.officeContactNo },
  ];
}

export function farmerColumns<R>(get: Get<R>, maps = 'selectedFarmer -> farmer'): ExportColumn<R>[] {
  return [
    { header: 'Farmer ID', maps: `${maps}.id`, get: (r) => get(r)?.id },
    { header: 'Farmer Name', maps: `${maps}.farmerfName/farmermName/farmerlName`, get: (r) => farmerName(get(r)) },
    { header: 'Farmer Code', maps: `${maps}.farmerCode`, get: (r) => get(r)?.farmerCode },
    { header: 'Farmer Mobile No', maps: `${maps}.primaryMobileNo`, get: (r) => get(r)?.primaryMobileNo },
  ];
}

export function customerColumns<R>(get: Get<R>, maps = 'customerName -> customer'): ExportColumn<R>[] {
  return [
    { header: 'Customer ID', maps: `${maps}.id`, get: (r) => get(r)?.id },
    { header: 'Customer Name', maps: `${maps}.organisationName`, get: (r) => get(r)?.organisationName },
    { header: 'Customer Code', maps: `${maps}.customerCode`, get: (r) => get(r)?.customerCode },
    { header: 'Customer Contact No', maps: `${maps}.primaryContactNo`, get: (r) => get(r)?.primaryContactNo },
    { header: 'Customer Email', maps: `${maps}.emailPrimary`, get: (r) => get(r)?.emailPrimary },
  ];
}

export function addressColumn<R>(label: string, get: Get<R>, maps: string): ExportColumn<R> {
  return { header: label, maps: `${maps} -> address.address1..pincode`, get: (r) => addressText(get(r)) };
}

/** Product, category and variant identity for a line item. */
export function productColumns<R>(get: Get<R>, variant: Get<R>, maps = 'productName -> product'): ExportColumn<R>[] {
  return [
    { header: 'Product ID', maps: `${maps}.id`, get: (r) => get(r)?.id },
    { header: 'Product Code', maps: `${maps}.productCode`, get: (r) => get(r)?.productCode },
    { header: 'Product Name', maps: `${maps}.name`, get: (r) => get(r)?.name },
    { header: 'Category', maps: `${maps}.category -> product_category.name`, get: (r) => get(r)?.category?.name },
    { header: 'Variant', maps: 'variant -> product_varient.variantName', get: (r) => variant(r)?.variantName },
    { header: 'Variant Code', maps: 'variant -> product_varient.variantCode', get: (r) => variant(r)?.variantCode },
  ];
}

export function uomColumn<R>(label: string, get: Get<R>, maps: string): ExportColumn<R> {
  return { header: label, maps: `${maps} -> uom.unit`, get: (r) => get(r)?.unit };
}

/** Record id and timestamps of the module's own row. */
export function auditColumns<R>(get: Get<R>, table: string): ExportColumn<R>[] {
  return [
    { header: 'Created Date', maps: `${table}.createdAt`, type: 'datetime', get: (r) => get(r)?.createdAt },
    { header: 'Updated Date', maps: `${table}.updatedAt`, type: 'datetime', get: (r) => get(r)?.updatedAt },
  ];
}
