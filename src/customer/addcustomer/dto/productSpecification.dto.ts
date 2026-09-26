export interface ProductSpecificationDto {
  id?: string;
  articleName?: string;

  specifications?: string;

  packingMaterialSpec?: string;

  parameters?: string;

  rejectionCriteria?: string;

  comment?: string;
}