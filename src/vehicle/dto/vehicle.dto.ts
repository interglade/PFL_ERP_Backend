import { Status } from '../../utils/status.enum';

/** Writable fields, as sent by the registration form. */
export interface VehicleInput {
  vehicleNo?: string | null;
  vehicleType?: string | null;
  capacityKg?: number | string | null;
  rcNumber?: string | null;
  transporterId?: string | null;
  remarks?: string | null;
  /** Only `draft` is honoured on create. */
  status?: Status;
}

/** GET /vehicles/view/:id and /update/:id */
export interface VehicleDetailDto {
  id: string;
  vehicleCode: string | null;
  vehicleNo: string | null;
  vehicleType: string | null;
  capacityKg: number | null;
  rcNumber: string | null;
  transporterId: string | null;
  transporterName: string | null;
  remarks: string | null;
  status: Status;
  createdBy: string | null;
  approvedBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

/** One row of GET /vehicles */
export interface VehicleListItemDto extends VehicleDetailDto {
  canEdit: boolean;
}

/** One entry of GET /vehicles/filterData/filter/all */
export interface VehiclePickerDto {
  id: string;
  vehicleCode: string | null;
  vehicleNo: string | null;
  vehicleType: string | null;
  capacityKg: number | null;
  rcNumber: string | null;
  transporterId: string | null;
  transporterName: string | null;
  status: Status;
}

/** GET /vehicles/by-number/:vehicleNo */
export interface VehicleLookupDto {
  id: string;
  vehicleNo: string | null;
  status: Status;
  transporterName: string | null;
}
