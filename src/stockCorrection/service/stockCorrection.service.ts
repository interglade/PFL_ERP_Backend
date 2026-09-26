import { inject, injectable } from "inversify";
import { DataSource, DeepPartial } from "typeorm";

import { TYPES } from "../../types";
import { StockCorrectionRepository } from "../repository/stockCorrection.repository";
import { InventoryStockRepository } from "../../inventoryStock/repository/inventoryStock.repository";
import { ApproveRejectDto, CreateStockCorrectionDto } from "../dto/stockCorrection.dto";
import { CorrectionStatus, CorrectionType, StockCorrection } from "../entity/stockCorrection.entity";



@injectable()
export class StockCorrectionService {
  constructor(
    @inject(TYPES.StockCorrectionRepository)
    private readonly stockCorrectionRepo: StockCorrectionRepository,

    @inject(TYPES.InventoryStockRepository)
    private readonly inventoryStockRepo: InventoryStockRepository,

    @inject(TYPES.DataSource)
    private readonly dataSource: DataSource,
  ) {}

  // -----------------------------------------------------------------------
  // Submit Correction (inward OR dump)
  // -----------------------------------------------------------------------
  async submitCorrection(dto: CreateStockCorrectionDto, userId: string) {
    const stock = await this.inventoryStockRepo.findOne({
      where: { id: dto.inventoryStockId },
      relations: ["company", "location", "product", "variant"],
    });

    if (!stock) throw new Error("Inventory stock not found");

    let correctionDelta: number;
    let physicalQty: number;

    if (dto.correctionType === CorrectionType.DAMAGE_WRITE_OFF) {
      // Dump: stock decreases by dumpQty
      const dumpQty = Number(dto.dumpQty ?? 0);
      if (dumpQty <= 0) throw new Error("dumpQty must be > 0 for DAMAGE_WRITE_OFF");
      physicalQty = Number(stock.inwardQty) - dumpQty;
      correctionDelta = -dumpQty; // negative
    } else {
      // Physical count / system error / other: direct physical qty given
      physicalQty = Number(dto.physicalQty);
      correctionDelta = physicalQty - Number(stock.inwardQty);
    }

    const correction = this.stockCorrectionRepo.create({
      inventoryStock: { id: stock.id },
      company: stock.company,
      location: stock.location,
      product: stock.product,
      variant: stock.variant,

      // Inward snapshot
      systemQty: Number(stock.inwardQty),
      physicalQty,
      correctionDelta,
      correctionAmt: Number(dto.correctionAmt ?? 0),

      // Dump fields
      dumpQty: Number(dto.dumpQty ?? 0),
      dumpAmt: Number(dto.dumpAmt ?? 0),
      dumpReason: dto.dumpReason ?? null,
      dumpRemarks: dto.dumpRemarks ?? null,
      dumpDate: dto.dumpDate ? new Date(dto.dumpDate) : null,

      correctionType: dto.correctionType,
      reason: dto.reason ?? null,
      correctionDate: dto.correctionDate ? new Date(dto.correctionDate) : null,
      status: CorrectionStatus.PENDING,
      createdBy: { id: userId } as any,
    } as DeepPartial<StockCorrection>);

    return this.stockCorrectionRepo.save(correction);
  }

  // -----------------------------------------------------------------------
  // Approve — updates inventory_stock (inwardQty + dumpQty if dump)
  // -----------------------------------------------------------------------
  async approveCorrection(correctionId: string, approverId: string, dto?: ApproveRejectDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const correction = await this.stockCorrectionRepo.findOne({
        where: { id: correctionId },
        relations: ["inventoryStock"],
      });

      if (!correction) throw new Error("Correction not found");
      if (correction.status !== CorrectionStatus.PENDING)
        throw new Error("Correction already processed");

      const stock = correction.inventoryStock;

      // 1. Update inwardQty (applies to ALL correction types)
      stock.inwardQty = Number(stock.inwardQty) + Number(correction.correctionDelta);

      // 2. Update inwardAmt if provided
      if (Number(correction.correctionAmt) !== 0) {
        stock.inwardAmt = Number(stock.inwardAmt) + Number(correction.correctionAmt);
      }

      // 3. Dump specific — also update dumpQty & dumpAmt on inventory_stock
      if (correction.correctionType === CorrectionType.DAMAGE_WRITE_OFF) {
        stock.dumpQty = Number(stock.dumpQty ?? 0) + Number(correction.dumpQty);
        stock.dumpAmt = Number(stock.dumpAmt ?? 0) + Number(correction.dumpAmt);
      }

      await queryRunner.manager.save(stock);

      // 4. Mark correction approved
      correction.status = CorrectionStatus.APPROVED;
      correction.approvedBy = { id: approverId } as any;
      correction.approvedAt = new Date();
      if (dto?.remarks) correction.remarks = dto.remarks;

      await queryRunner.manager.save(correction);
      await queryRunner.commitTransaction();

      return correction;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // -----------------------------------------------------------------------
  // Reject — no stock changes
  // -----------------------------------------------------------------------
  async rejectCorrection(correctionId: string, approverId: string, dto?: ApproveRejectDto) {
    const correction = await this.stockCorrectionRepo.findOne({
      where: { id: correctionId },
    });

    if (!correction) throw new Error("Correction not found");
    if (correction.status !== CorrectionStatus.PENDING)
      throw new Error("Correction already processed");

    correction.status = CorrectionStatus.REJECTED;
    correction.approvedBy = { id: approverId } as any;
    correction.approvedAt = new Date();
    if (dto?.remarks) correction.remarks = dto.remarks;

    return this.stockCorrectionRepo.save(correction);
  }

  // -----------------------------------------------------------------------
  // Get all corrections for a stock record
  // -----------------------------------------------------------------------
  async getByInventoryStock(inventoryStockId: string) {
    const stock = await this.inventoryStockRepo.findOne({
      where: { id: inventoryStockId },
      relations: ["product", "variant", "location", "company"],
    });

    if (!stock) throw new Error("Inventory stock not found");

    const corrections = await this.stockCorrectionRepo.find({
      where: { inventoryStock: { id: inventoryStockId } },
      relations: ["createdBy", "approvedBy"],
      order: { createdAt: "DESC" },
    });

    return {
      currentStock: {
        id: stock.id,
        inwardQty: Number(stock.inwardQty),
        inwardAmt: Number(stock.inwardAmt),
        dumpQty: Number(stock.dumpQty),
        dumpAmt: Number(stock.dumpAmt),
        product: (stock.product as any)?.name ?? null,
        variant: (stock.variant as any)?.variantName ?? null,
        location: (stock.location as any)?.name ?? null,
        company: (stock.company as any)?.name ?? null,
      },
      corrections,
      pendingCorrections: corrections.filter((c) => c.status === CorrectionStatus.PENDING),
    };
  }

  // -----------------------------------------------------------------------
  // Get all pending corrections
  // -----------------------------------------------------------------------
  async getPendingCorrections() {
    return this.stockCorrectionRepo.find({
      where: { status: CorrectionStatus.PENDING },
      relations: ["inventoryStock", "product", "variant", "location", "company", "createdBy"],
      order: { createdAt: "DESC" },
    });
  }

  // -----------------------------------------------------------------------
  // Get single correction by ID
  // -----------------------------------------------------------------------
  async getById(id: string) {
    const correction = await this.stockCorrectionRepo.findOne({
      where: { id },
      relations: ["inventoryStock", "product", "variant", "location", "company", "createdBy", "approvedBy"],
    });

    if (!correction) throw new Error("Correction not found");
    return correction;
  }
}
