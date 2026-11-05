import { AddressPayload } from '../../transport/transport.utils';
import { Status } from '../../utils/status.enum';
import { TransporterType } from '../entity/transporter.entity';

/** Writable fields, as sent by the registration form. */
export interface TransporterInput {
  name?: string | null;
  transporterType?: TransporterType | null;
  contactPerson?: string | null;
  primaryPhone?: string | null;
  altPhone?: string | null;
  email?: string | null;
  address?: Partial<AddressPayload> | null;
  gstin?: string | null;
  pan?: string | null;
  bankName?: string | null;
  accountHolderName?: string | null;
  accountNo?: string | null;
  ifsc?: string | null;
  upiId?: string | null;
  paymentTerms?: string | null;
  creditDays?: number | string | null;
  remarks?: string | null;
  /** Only `draft` is honoured on create. */
  status?: Status;
}

/** GET /transporters/view/:id and /update/:id */
export interface TransporterDetailDto {
  id: string;
  transporterCode: string | null;
  name: string | null;
  transporterType: TransporterType | null;
  contactPerson: string | null;
  primaryPhone: string | null;
  altPhone: string | null;
  email: string | null;
  address: AddressPayload;
  gstin: string | null;
  pan: string | null;
  bankName: string | null;
  accountHolderName: string | null;
  accountNo: string | null;
  ifsc: string | null;
  upiId: string | null;
  paymentTerms: string | null;
  creditDays: number | null;
  remarks: string | null;
  status: Status;
  createdBy: string | null;
  approvedBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

/** One row of GET /transporters */
export interface TransporterListItemDto extends Omit<TransporterDetailDto, 'address'> {
  address: string;
  canEdit: boolean;
  vehicleCount: number;
  driverCount: number;
}

/** One entry of GET /transporters/filterData/filter/all */
export interface TransporterPickerDto {
  id: string;
  transporterCode: string | null;
  name: string | null;
  transporterType: TransporterType | null;
  primaryPhone: string | null;
  status: Status;
}
