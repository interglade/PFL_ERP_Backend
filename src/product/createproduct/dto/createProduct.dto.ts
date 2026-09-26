import { z } from "zod";
import { Acceptability } from "../entity/quantityParameter.entity";


export const ProductVariantSchema = z.object({
  count: z.string().optional(),
  size: z.string().optional(),
  variety: z.string().optional(),
  origin: z.string().optional(),
  brand: z.string().optional(),
});

export const QualityParameterSchema = z.object({
  name: z.string().min(1, "Parameter name is required"),
  type: z.nativeEnum(Acceptability).optional(),
});

export const CreateProductSchema = z
  .object({
    name: z.string().min(1, "Product name is required"),

    image: z.string().optional(),

    description: z.string().optional(),

    classification: z.string().uuid().optional(),

    category: z.string().uuid().optional(),

    subcategory: z.string().uuid().optional(),

    uom: z.string().uuid(),

    packingType: z.string().optional(),

    prefix: z
      .string()
      .min(1, "Prefix is required")
      .max(20),

    shelfLife: z.coerce.number().optional(),

    storageTemp: z.coerce.number().optional(),

    thresholdStock: z.coerce.number().optional(),

    variant: z.array(ProductVariantSchema).optional(),

    qualityParameters: z
      .array(QualityParameterSchema)
      .optional(),
  })
  .strict();

export type CreateProductDto = z.infer<typeof CreateProductSchema>;