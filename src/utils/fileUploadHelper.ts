/**
 * Helper function to extract file URLs from uploaded files
 * Handles both S3 uploads (location property) and local uploads (path property)
 * Also handles different field names: 'anyAttachment' and 'anyAttachment[]'
 * @param files - Array of uploaded files from multer
 * @returns Array of file URLs/paths, filtered to remove invalid entries
 */
export function extractFileUrls(files: any[]): string[] {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return [];
  }

  return files
    .filter(file => {
      // Check if file has valid URL and is an attachment field
      const hasValidUrl = file && (file.location || file.path);
      const isAttachmentField = file.fieldname === 'anyAttachment' || file.fieldname === 'anyAttachment[]';
      return hasValidUrl && isAttachmentField;
    })
    .map(file => file.location || file.path); // Use location for S3, fallback to path for local
}

/**
 * Helper function to safely set attachment URLs on request data
 * Only sets the anyAttachment property if there are valid URLs
 * Handles both 'anyAttachment' and 'anyAttachment[]' field names
 * @param requestData - The request body data object
 * @param files - Array of uploaded files from multer
 */
export function setAttachmentUrls(requestData: any, files: any[]): void {
  const urls = extractFileUrls(files);
  if (urls.length > 0) {
    requestData.anyAttachment = urls;
  }
}