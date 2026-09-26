import * as XLSX from 'xlsx';
import { parse, format } from 'date-fns';
export const headerMapping = {
  "First Name": "firstName",
  "Last Name": "lastName",
  "Username": "username",
  "Primary MobiLe Number": "primaryMobNo",
  "Primary Email": "primaryEmail",
  "Residential Address": "residentialAddress.address1",
  "Location": "residentialAddress.location",
  "City": "residentialAddress.city",
  "State": "residentialAddress.state",
  "Pincode": "residentialAddress.pincode",
  "Permanent Adress": "permanentAddress.address1",
  "Location.1": "permanentAddress.location",
  "City.1": "permanentAddress.city",
  "State.1": "permanentAddress.state",
  "Pincode.1": "permanentAddress.pincode",
  "Department": "department",
  "Company Name": "companyName.name",
  "Office Address": "companyName.officeAddress",
  "Joining Date": "joiningDate",
  "Work Email": "workEmail",
  "Joining Location": "joiningLocation.name",
  "Current Work Location": "currentWorkLocation.name",
  "Access Location": "accessLocation",
  "Document Type": "permissions.documentDefinition.documentType",
  "Document Name": "permissions.documentDefinition.name",
  "Can Create": "permissions.canCreate",
  "Can View": "permissions.canView",
  "Can Download": "permissions.canDownload",
  "Can Edit": "permissions.canEdit",
  "Can Delete": "permissions.canDelete"
};

export function parseExcel(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  return rawData;
}



export function parseExcelDate(dateValue: any): string | null {
  
  if (!dateValue) return null;

  if (typeof dateValue === 'number') {
    // Excel serial date -> JS Date
    const excelEpoch = new Date(1899, 11, 30); // Excel's day 1 is 1900-01-01, offset by 2 days
    excelEpoch.setDate(excelEpoch.getDate() + dateValue);
    return format(excelEpoch, 'yyyy-MM-dd');
  } else if (typeof dateValue === 'string') {
    // Try parsing date string
    const parsedDate = new Date(dateValue);
    if (!isNaN(parsedDate.getTime())) {
      return format(parsedDate, 'yyyy-MM-dd');
    }
  }
  return null;
}
