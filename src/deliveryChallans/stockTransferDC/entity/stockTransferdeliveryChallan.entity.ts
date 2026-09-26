// entities/StockTransferDeliveryChallan.ts
import { ChildEntity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { DeliveryChallanPurchase } from '../../deliverychllan/entity/deliveryChallan.entity';
import { Branches } from '../../../branch/entity/branches.entity';

export enum StockTransferType {
  CC_DC_STOCK_TRANSFER = 'cc-dc stock transfer',
  DC_DC_STOCK_TRANSFER = 'dc-dc stock transfer',
  DC_CC_STOCK_TRANSFER = 'dc-cc stock transfer',
  CC_CC_STOCK_TRANSFER = 'cc-cc stock transfer',
}

@ChildEntity('stock-transfer-delivery-challan')
export class StockTransferDeliveryChallan extends DeliveryChallanPurchase {
  @Column({
    type: 'enum',
    enum: StockTransferType,
  })
  stockTransferType: StockTransferType;

  @ManyToOne(() => Branches, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'from_location_id' })
  fromLocation: Branches;

  @ManyToOne(() => Branches, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'to_location_id' })
  toLocation: Branches;
}
