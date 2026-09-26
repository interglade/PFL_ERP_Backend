import { CorrectionType, DumpReason } from "../entity/stockCorrection.entity";


export interface CreateStockCorrectionDto {
  inventoryStockId: string;
  correctionType: CorrectionType;
  physicalQty: number;
  correctionAmt?: number;
  reason?: string;
  correctionDate?: string;

  // Dump specific (required when correctionType = DAMAGE_WRITE_OFF)
  dumpQty?: number;
  dumpAmt?: number;
  dumpReason?: DumpReason;
  dumpRemarks?: string;
  dumpDate?: string;
}

export interface ApproveRejectDto {
  remarks?: string;
}
