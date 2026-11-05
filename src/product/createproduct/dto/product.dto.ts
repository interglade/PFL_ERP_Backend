import { Acceptability } from "../entity/quantityParameter.entity";

// export interface createProductDto {
  
// }

export interface QualityParameterDto {
  id?: string;
  name?: string;
  type?: Acceptability;
}

export interface ProductVariantDto {
  id?: string;
  productName?: string | null;
  variantName?: string | null;
  variantCode?: string | null;
  isActive?: boolean;
  /** Attribute values of this combination. */
  valueIds?: string[];
  count?: string | null;
  size?: string | null;
  variety?: string | null;
  origin?: string | null;
  brand?: string | null;
}

export interface UomDto {
  id?: string;
  name?: string;
  shortName?: string;
}

export interface ProductSubcategoryDto {
  id?: string;
  name?: string;
}

export interface ProductCategoryDto {
  id?: string;
  name?: string;
}

export interface ProductClassificationDto {
  id?: string;
  name?: string;
}

export interface CreateProductDto {
  name?: string;

  image?: string;

  description?: string;

  classificationId?: string;

  categoryId?: string;

  subcategoryId?: string;

  uomId?: string;

  productCode?: string ;

  packingType?: string;

  prefix?: string;

  shelfLife?: number;

  storageTemp?: number;

  thresholdStock?: number | null;

  /**
   * `{ attributeValueIds, combinations? }`, as a JSON string from the
   * multipart form. Absent leaves the variants unchanged.
   */
  variantSetup?: string | { attributeValueIds: string[]; combinations?: string[][] };

  qualityParameters?: QualityParameterDto[];
}

export interface ProductListResponseDto {
  id: string;
  name: string;
  packingType: string | null;
  productCode: string | null;
  shelfLife: number | null;
  storageTemp: number | null;

  category: ProductCategoryDto | null;
  classification: ProductClassificationDto | null;
  uom: UomDto | null;
  subcategory: ProductSubcategoryDto | null;
}

export interface ProductDetailResponseDto {
  id: string;
  name: string;
  image: string | null;
  description: string | null;

  prefix: string | null;
  packingType: string | null;

  shelfLife: number | null;
  storageTemp: number | null;
  thresholdStock: number | null;

  classification: string | null;
  category: string | null;
  subcategory: string | null;
  uom: string | null;

  qualityParameters: QualityParameterDto[];

  /** The values the product may vary by, in attribute order. */
  attributeValues: { id: string; value: string; attributeId?: string; attribute?: string }[];

  variant: ProductVariantDto[];
}

export interface ProductClassificationResponseDto {
  id: string;
  name: string;
}

export interface CreateProductClassificationDto{
  name: string;
}

export interface ProductCategoryResponseDto {
  id: string;
  name: string;
  productClassification: string | null;
}

export interface CreateProductCategoryDto {
  name: string;
  productClassification: string;
}

export interface ProductSubcategoryResponseDto {
  id: string;
  name: string;
  category: string | null;
}

export interface CreateProductSubcategoryDto {
  name: string;
  category: string;
}