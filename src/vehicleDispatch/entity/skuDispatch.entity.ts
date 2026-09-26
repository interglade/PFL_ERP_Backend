import {
    Entity,
    Column,
   
    ManyToOne,
    JoinColumn,
  } from "typeorm";

import { VehicleDispatch } from "./vehicleDispatch.entity";
import Model from "../../global/model.entity";

  
  @Entity({ name: "sku" })
  export class SKU extends Model {
   
  
    @Column()
    skuName: string;
  
    @Column({ type: "float" })
    dispatchQuantity: number;
  
    
  
    @ManyToOne(() => VehicleDispatch , { onDelete: "SET NULL" })
    @JoinColumn({ name: "dispatchId" })
    dispatch: VehicleDispatch ;
  }
  