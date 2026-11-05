import { z } from "zod";
import { Acceptability } from "../entity/quantityParameter.entity";


/**
 * The allowed attribute values and the combinations to keep as variants
 * (docs/product-variant-plan.md §3). Sent as a JSON string by the multipart
 * product form.
 */
export const VariantSetupSchema = z.object({
  attributeValueIds: z.array(z.string().uuid()),
  combinations: z.array(z.array(z.string().uuid())).optional(),
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

    variantSetup: z.union([z.string(), VariantSetupSchema]).optional(),

    qualityParameters: z
      .array(QualityParameterSchema)
      .optional(),
  })
  .strict();

export type CreateProductDto = z.infer<typeof CreateProductSchema>;