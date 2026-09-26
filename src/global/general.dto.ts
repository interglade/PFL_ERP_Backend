/** Returned by delete service method */
export interface DeleteResultDto {
  No: string;
}

export interface DeletedItemDto {
  id: string;
  No: string;
}

/** Returned by deleteMultiple service method */
export interface BulkDeleteResultDto {
  success: DeletedItemDto[];
  failed: { id: string; reason: string }[];
  message: string;
}