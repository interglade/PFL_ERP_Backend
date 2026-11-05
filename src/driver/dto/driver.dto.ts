import { AddressPayload } from '../../transport/transport.utils';
import { Status } from '../../utils/status.enum';

/** Writable fields, as sent by the registration form. */
export interface DriverInput {
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  altPhoneNumber?: string | null;
  email?: string | null;
  address?: Partial<AddressPayload> | null;
  licenseNo?: string | null;
  licenseType?: string | null;
  licenseExpiry?: string | null;
  transporterId?: string | null;
  remarks?: string | null;
  /** Only `draft` is honoured on create. */
  status?: Status;
}

/** GET /drivers/view/:id and /update/:id */
export interface DriverDetailDto {
  id: string;
  driverCode: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  phoneNumber: string | null;
  altPhoneNumber: string | null;
  email: string | null;
  address: AddressPayload;
  licenseNo: string | null;
  licenseType: string | null;
  licenseExpiry: string | null;
  transporterId: string | null;
  transporterName: string | null;
  remarks: string | null;
  status: Status;
  createdBy: string | null;
  approvedBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

/** One row of GET /drivers */
export interface DriverListItemDto extends Omit<DriverDetailDto, 'address'> {
  address: string;
  canEdit: boolean;
}

/** One entry of GET /drivers/filterData/filter/all */
export interface DriverPickerDto {
  id: string;
  driverCode: string | null;
  fullName: string;
  phoneNumber: string | null;
  altPhoneNumber: string | null;
  licenseNo: string | null;
  /** One line, for display next to the selection. */
  address: string | null;
  transporterId: string | null;
  transporterName: string | null;
  status: Status;
}

/** GET /drivers/by-phone/:phone */
export interface DriverLookupDto {
  id: string;
  fullName: string;
  phoneNumber: string | null;
  status: Status;
}
