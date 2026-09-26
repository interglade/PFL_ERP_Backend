// ==================== DIGITALOCEAN SPACES STORAGE ====================
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import ejs from 'ejs';
import { injectable } from 'inversify';
import path from 'path';
import puppeteer from 'puppeteer';
import { s3 } from '../middleware/spaces.config';
import logger from './logger';

@injectable()
export class PdfGeneratorService {
  private bucketName: string;

  constructor() {
    this.bucketName = process.env.DO_SPACES_BUCKET!;
  }

  /**
   * Generate PDF from EJS template and upload to DigitalOcean Spaces
   * @param templateName - Name of the EJS template file (without .ejs extension)
   * @param data - Data to pass to the template
   * @param fileName - Desired filename (e.g., 'voucher_123.pdf')
   * @returns DigitalOcean Spaces URL
   */
  async generatePdfFromTemplate(
    templateName: string,
    data: any,
    fileName: string
  ): Promise<string> {
    try {
      // Render HTML from EJS template
      const templatePath = path.join(__dirname, `../templates/${templateName}.ejs`);
      const html = await ejs.renderFile(templatePath, { data });

      // Generate PDF using Puppeteer
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        timeout: 60000,
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({ format: 'A4' });
      await browser.close();

      // Upload PDF to DigitalOcean Spaces
      const timestamp = Date.now();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const spacesKey = `pdfs/${timestamp}_${safeFileName}`;

      const uploadParams = {
        Bucket: this.bucketName,
        Key: spacesKey,
        Body: Buffer.from(pdfBuffer),
        ContentType: 'application/pdf',
        ACL: 'public-read' as const, // Make file publicly accessible
      };

      await s3.send(new PutObjectCommand(uploadParams));

      // Return public URL
      const publicUrl = `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${spacesKey}`;
      return publicUrl;
    } catch (error) {
      logger.error('PDF generation failed: ' + error);
      throw new Error('Failed to generate PDF');
    }
  }

  /**
   * Generate invoice PDF and upload to DigitalOcean Spaces
   * @param data - Invoice data
   * @returns DigitalOcean Spaces URL
   */
  async generateInvoicePdf(data: any): Promise<string> {
    try {
      // Render HTML from EJS Template
      const templatePath = path.join(__dirname, '../templates/invoiceTemplate.ejs');

      const html = await ejs.renderFile(templatePath, { data });

      // Generate PDF using Puppeteer
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        timeout: 60000,
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = Buffer.from(await page.pdf({ format: 'A4' }));
      await browser.close();

      // Upload PDF to DigitalOcean Spaces
      const timestamp = Date.now();
      const invoiceNo = data.invoiceNo || 'unknown';
      const safeInvoiceNo = invoiceNo.replace(/[^a-zA-Z0-9._-]/g, '_');
      const spacesKey = `invoices/invoice_${safeInvoiceNo}_${timestamp}.pdf`;

      const uploadParams = {
        Bucket: this.bucketName,
        Key: spacesKey,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
        ACL: 'public-read' as const, // Make file publicly accessible
      };

      await s3.send(new PutObjectCommand(uploadParams));

      // Return public URL
      const publicUrl = `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${spacesKey}`;
      return publicUrl;
    } catch (error) {
      logger.error('Error generating invoice PDF: ' + error);
      throw error;
    }
  }

  /**
   * Get Excel file from DigitalOcean Spaces
   * @param key - Spaces key/path to the Excel file
   * @returns Buffer containing the file data
   */
  async getExcelFromSpaces(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await s3.send(command);

      if (!response.Body) {
        throw new Error('No file content found in Spaces response');
      }

      const bytes = await response.Body.transformToByteArray();
      const fileBuffer = Buffer.from(bytes);

      return fileBuffer;
    } catch (error) {
      logger.error('Error reading Excel file from Spaces: ' + error);
      throw new Error(`Failed to read Excel file: ${key}`);
    }
  }

  /**
   * Alias for backward compatibility (if getExcelFromS3 is called)
   */
  async getExcelFromS3(key: string): Promise<Buffer> {
    return this.getExcelFromSpaces(key);
  }

  /**
   * Delete a PDF file from DigitalOcean Spaces
   * @param fileUrl - Full URL or key of the PDF file to delete
   */
  async deletePdf(fileUrl: string): Promise<void> {
    try {
      // Extract key from URL if full URL is provided
      let key: string;
      if (fileUrl.startsWith('https://')) {
        const urlParts = fileUrl.split('/');
        key = urlParts.slice(-2).join('/'); // Gets "pdfs/filename" or "invoices/filename"
      } else {
        key = fileUrl; // Assume it's already a key
      }

      const deleteCommand = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await s3.send(deleteCommand);
    } catch (error) {
      logger.error('Error deleting PDF from Spaces: ' + error);
      throw error;
    }
  }

  /**
   * Check if a PDF file exists in DigitalOcean Spaces
   * @param fileUrl - Full URL or key of the PDF file
   * @returns boolean
   */
  async pdfExists(fileUrl: string): Promise<boolean> {
    try {
      // Extract key from URL if full URL is provided
      let key: string;
      if (fileUrl.startsWith('https://')) {
        const urlParts = fileUrl.split('/');
        key = urlParts.slice(-2).join('/'); // Gets "pdfs/filename" or "invoices/filename"
      } else {
        key = fileUrl; // Assume it's already a key
      }

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await s3.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      logger.error('Error checking PDF existence: ' + error);
      throw error;
    }
  }

  /**
   * Get a signed URL for temporary access to a PDF (optional, for private files)
   * @param key - Spaces key of the PDF file
   * @param expiresIn - Expiration time in seconds (default: 1 hour)
   * @returns Signed URL
   */
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      // For public files, just return the public URL
      // For private files, you would use getSignedUrl from @aws-sdk/s3-request-presigner
      const publicUrl = `https://${this.bucketName}.sgp1.digitaloceanspaces.com/${key}`;
      return publicUrl;
    } catch (error) {
      logger.error('Error generating signed URL: ' + error);
      throw error;
    }
  }

  /**
   * List all PDFs in a specific folder
   * @param prefix - Folder prefix (e.g., 'pdfs/', 'invoices/')
   * @returns Array of file keys
   */
  async listPdfs(prefix: string = ''): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const response = await s3.send(command);
      const files = response.Contents?.map(obj => obj.Key!).filter(key => key.endsWith('.pdf')) || [];
      
      return files;
    } catch (error) {
      logger.error('Error listing PDFs: ' + error);
      throw error;
    }
  }

  /**
   * Clean up old PDFs (optional utility method)
   * @param olderThanDays - Delete PDFs older than this many days
   * @param prefix - Folder prefix to clean (e.g., 'pdfs/', 'invoices/')
   */
  async cleanupOldPdfs(olderThanDays: number = 30, prefix: string = ''): Promise<number> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const response = await s3.send(command);
      const files = response.Contents?.filter(obj => obj.Key?.endsWith('.pdf')) || [];
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      let deletedCount = 0;
      
      for (const file of files) {
        if (file.LastModified && file.LastModified < cutoffDate && file.Key) {
          await this.deletePdf(file.Key);
          deletedCount++;
        }
      }
      
      logger.info(`Cleaned up ${deletedCount} old PDF files`);
      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up old PDFs: ' + error);
      throw error;
    }
  }
}