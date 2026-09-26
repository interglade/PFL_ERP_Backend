import {
  Entity,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { Farmer } from "./farmer.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import Model from "../../global/model.entity";


@Entity("crop")
export class Crop extends Model {
  // @Column("character varying", { length: 100 })
  // crop: string;

// @OneToMany(() => Product, (product) => product.crop)
// crops: Product[];

@ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'crops' })
  crop: Product;

  @Column("character varying", { length: 100, nullable: true })
  variety: string;

  @Column("integer", { nullable: true })
  noOfPlants: number;

  @Column("date", { nullable: true })
  pruningDate: Date;

  @Column("date", { nullable: true })
  expectedHarvestDate: Date;

  @Column("decimal", { precision: 10, scale: 2, nullable: true })
  expectedQuantityInTonnes: number;

  @ManyToOne(() => Farmer, (farmer) => farmer.crops, { onDelete: "SET NULL" })
  farmer: Farmer;
}
