import { inject } from 'inversify';
import {
    controller,
    httpGet,
    httpPost,
    request,
    response,
    next,
} from 'inversify-express-utils';
import { Request, Response, NextFunction } from 'express';




import * as ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { deserializeUser, requireUser } from '../../middleware/deserializeUser';
import { ProcurementCrystalReportService, ProcurementReportFilters } from '../service/procurementCrystalReport.service';
import { TYPES } from '../../types';
import logger from '../../utils/logger';
import AppError from '../../utils/appError';

@controller('/procurement-reports', deserializeUser, requireUser)
export class ProcurementCrystalReportController {
    constructor(
        @inject(TYPES.ProcurementCrystalReportService)
        private procurementReportService: ProcurementCrystalReportService
    ) { }

    /**
     * Generate detailed procurement report (Net Weight based)
     * POST /procurement-reports/detailed
     */
    @httpPost('/detailed')
    public async generateDetailedReport(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: ProcurementReportFilters = req.body;

            // Convert string dates to Date objects
            if (filters.startDate) {
                filters.startDate = new Date(filters.startDate);
            }
            if (filters.endDate) {
                filters.endDate = new Date(filters.endDate);
            }

            const reportData =
                await this.procurementReportService.generateDetailedProcurementReport(filters);

            // Calculate totals
            const totals = this.calculateTotals(reportData);

            logger.info('Detailed procurement report generated successfully', {
                recordCount: reportData.length,
                filters,
            });

            res.status(200).json({
                status: 'success',
                data: reportData,
                summary: totals,
                meta: {
                    totalRecords: reportData.length,
                    generatedAt: new Date().toISOString(),
                    filters,
                    note: 'Quantities calculated based on Net Weight',
                },
            });
        } catch (error) {
            logger.error('Error generating detailed procurement report:', error);
            next(new AppError(500, 'Failed to generate procurement report'));
        }
    }

    /**
     * Generate procurement summary report
     * POST /procurement-reports/summary
     */
    @httpPost('/summary')
    public async generateSummaryReport(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: ProcurementReportFilters = req.body;

            if (filters.startDate) {
                filters.startDate = new Date(filters.startDate);
            }
            if (filters.endDate) {
                filters.endDate = new Date(filters.endDate);
            }

            const summaryData =
                await this.procurementReportService.generateProcurementSummary(filters);

            logger.info('Procurement summary report generated successfully');

            res.status(200).json({
                status: 'success',
                data: summaryData,
                meta: {
                    generatedAt: new Date().toISOString(),
                    filters,
                    note: 'All quantities based on Net Weight',
                },
            });
        } catch (error) {
            logger.error('Error generating procurement summary:', error);
            next(new AppError(500, 'Failed to generate procurement summary'));
        }
    }

    /**
     * Generate vendor-wise procurement report
     * POST /procurement-reports/vendor-wise
     */
    @httpPost('/vendor-wise')
    public async generateVendorWiseReport(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: ProcurementReportFilters = req.body;

            if (filters.startDate) {
                filters.startDate = new Date(filters.startDate);
            }
            if (filters.endDate) {
                filters.endDate = new Date(filters.endDate);
            }

            const reportData =
                await this.procurementReportService.generateVendorWiseProcurement(filters);

            logger.info('Vendor-wise procurement report generated successfully', {
                recordCount: reportData.length,
            });

            res.status(200).json({
                status: 'success',
                data: reportData,
                meta: {
                    totalRecords: reportData.length,
                    generatedAt: new Date().toISOString(),
                    filters,
                },
            });
        } catch (error) {
            logger.error('Error generating vendor-wise procurement report:', error);
            next(new AppError(500, 'Failed to generate vendor-wise procurement report'));
        }
    }

    /**
     * Generate product-wise procurement report
     * POST /procurement-reports/product-wise
     */
    @httpPost('/product-wise')
    public async generateProductWiseReport(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: ProcurementReportFilters = req.body;

            if (filters.startDate) {
                filters.startDate = new Date(filters.startDate);
            }
            if (filters.endDate) {
                filters.endDate = new Date(filters.endDate);
            }

            const reportData =
                await this.procurementReportService.generateProductWiseProcurement(filters);

            logger.info('Product-wise procurement report generated successfully', {
                recordCount: reportData.length,
            });

            res.status(200).json({
                status: 'success',
                data: reportData,
                meta: {
                    totalRecords: reportData.length,
                    generatedAt: new Date().toISOString(),
                    filters,
                },
            });
        } catch (error) {
            logger.error('Error generating product-wise procurement report:', error);
            next(new AppError(500, 'Failed to generate product-wise procurement report'));
        }
    }

    /**
     * Export detailed procurement report to Excel
     * POST /procurement-reports/export/excel
     */
    @httpPost('/export/excel')
    public async exportToExcel(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: ProcurementReportFilters = req.body;

            if (filters.startDate) {
                filters.startDate = new Date(filters.startDate);
            }
            if (filters.endDate) {
                filters.endDate = new Date(filters.endDate);
            }

            const reportData =
                await this.procurementReportService.generateDetailedProcurementReport(filters);

            // Create Excel workbook
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Procurement Report');

            // Add title
            worksheet.mergeCells('A1:P1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = 'Procurement Report - Net Weight Based';
            titleCell.font = { size: 16, bold: true };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
            titleCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4472C4' },
            };
            titleCell.font = { ...titleCell.font, color: { argb: 'FFFFFFFF' } };

            // Add filter info
            worksheet.mergeCells('A2:P2');
            const filterCell = worksheet.getCell('A2');
            filterCell.value = `Period: ${filters.startDate ? format(filters.startDate, 'dd-MM-yyyy') : 'All'} to ${filters.endDate ? format(filters.endDate, 'dd-MM-yyyy') : 'All'}`;
            filterCell.alignment = { horizontal: 'center' };

            // Add headers
            const headers = [
                'GRN No',
                'GRN Date',
                'GRN Type',
                'Purchase Type',
                'Vendor Name',
                'Vendor Code',
                'Product Name',
                'Product Code',
                'Variant',
                'Category',
                'Net Weight (KG)',
                'Gross Weight (KG)',
                'Unit Price',
                'Amount',
                'UOM',
                'Branch',
            ];

            const headerRow = worksheet.addRow(headers);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF366092' },
            };
            headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
            headerRow.height = 25;

            // Add data rows
            let totalNetWeight = 0;
            let totalAmount = 0;

            reportData.forEach((grn) => {
                if (grn.products && grn.products.length > 0) {
                    grn.products.forEach((product) => {
                        const row = worksheet.addRow([
                            grn.grnNo,
                            grn.grnDate,
                            grn.grnType,
                            grn.purchaseType,
                            grn.vendorName,
                            grn.vendorCode,
                            product.productName,
                            product.productCode,
                            product.variantName,
                            product.category,
                            product.netWeight,
                            product.grossWeight,
                            product.unitPrice,
                            product.amount,
                            product.uom,
                            grn.branchName,
                        ]);

                        // Add borders
                        row.eachCell((cell) => {
                            cell.border = {
                                top: { style: 'thin' },
                                left: { style: 'thin' },
                                bottom: { style: 'thin' },
                                right: { style: 'thin' },
                            };
                        });

                        totalNetWeight += product.netWeight;
                        totalAmount += product.amount;
                    });
                }
            });

            // Add totals row
            const totalRow = worksheet.addRow([
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                'TOTAL:',
                totalNetWeight.toFixed(2),
                '',
                '',
                totalAmount.toFixed(2),
                '',
                '',
            ]);
            totalRow.font = { bold: true };
            totalRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFEB9C' },
            };

            // Auto-fit columns
            worksheet.columns.forEach((column) => {
                if (column && column.eachCell) {
                    let maxLength = 0;
                    column.eachCell({ includeEmpty: true }, (cell) => {
                        const cellValue = cell.value;
                        const columnLength = cellValue ? String(cellValue).length : 10;
                        if (columnLength > maxLength) {
                            maxLength = columnLength;
                        }
                    });
                    column.width = maxLength < 12 ? 12 : maxLength + 2;
                }
            });

            // Freeze header rows
            worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];

            // Set response headers for Excel download
            const fileName = `Procurement_Report_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.xlsx`;
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            // Write to response
            await workbook.xlsx.write(res);
            res.end();

            logger.info('Procurement report exported to Excel successfully', {
                recordCount: reportData.length,
                fileName,
            });
        } catch (error) {
            logger.error('Error exporting procurement report to Excel:', error);
            next(new AppError(500, 'Failed to export procurement report to Excel'));
        }
    }

    /**
     * Export vendor-wise report to Excel
     * POST /procurement-reports/export/vendor-wise-excel
     */
    @httpPost('/export/vendor-wise-excel')
    public async exportVendorWiseToExcel(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: ProcurementReportFilters = req.body;

            if (filters.startDate) {
                filters.startDate = new Date(filters.startDate);
            }
            if (filters.endDate) {
                filters.endDate = new Date(filters.endDate);
            }

            const reportData =
                await this.procurementReportService.generateVendorWiseProcurement(filters);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Vendor-wise Report');

            // Add title
            worksheet.mergeCells('A1:J1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = 'Vendor-wise Procurement Report';
            titleCell.font = { size: 16, bold: true };
            titleCell.alignment = { horizontal: 'center' };

            // Headers
            const headers = [
                'Vendor Name',
                'Vendor Code',
                'Contact',
                'Email',
                'Total GRNs',
                'Total Net Weight (KG)',
                'Total Amount',
                'Avg Order Value',
                'First Purchase',
                'Last Purchase',
            ];

            const headerRow = worksheet.addRow(headers);
            headerRow.font = { bold: true };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF366092' },
            };

            // Add data
            reportData.forEach((vendor) => {
                worksheet.addRow([
                    vendor.vendorName,
                    vendor.vendorCode,
                    vendor.vendorContact,
                    vendor.vendorEmail,
                    vendor.totalGRNs,
                    vendor.totalNetWeight.toFixed(2),
                    vendor.totalAmount.toFixed(2),
                    vendor.averageOrderValue.toFixed(2),
                    vendor.firstPurchaseDate,
                    vendor.lastPurchaseDate,
                ]);
            });

            // Auto-fit columns
            worksheet.columns.forEach((column) => {
                if (column) {
                    column.width = 15;
                }
            });

            const fileName = `Vendor_Wise_Report_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.xlsx`;
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            await workbook.xlsx.write(res);
            res.end();

            logger.info('Vendor-wise report exported successfully');
        } catch (error) {
            logger.error('Error exporting vendor-wise report:', error);
            next(new AppError(500, 'Failed to export vendor-wise report'));
        }
    }

    /**
     * Get available filter options
     * GET /procurement-reports/filters
     */
    @httpGet('/filters')
    public async getFilterOptions(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filterOptions = {
                grnTypes: ['purchase', 'transfer'],
                purchaseTypes: [
                    'fixed price sales',
                    'consignment sales / bikri',
                    'mgp sales',
                ],
                sources: ['vendor', 'farmer', 'market', 'direct'],
                note: 'All quantity calculations are based on Net Weight',
            };

            res.status(200).json({
                status: 'success',
                data: filterOptions,
            });
        } catch (error) {
            logger.error('Error fetching filter options:', error);
            next(new AppError(500, 'Failed to fetch filter options'));
        }
    }

    // Helper method to calculate totals
    private calculateTotals(reportData: any[]) {
        let totalNetWeight = 0;
        let totalGrossWeight = 0;
        let totalAmount = 0;
        let totalGRNs = reportData.length;

        reportData.forEach((grn) => {
            totalAmount += grn.totalAmount || 0;
            if (grn.products) {
                grn.products.forEach((product: any) => {
                    totalNetWeight += product.netWeight || 0;
                    totalGrossWeight += product.grossWeight || 0;
                });
            }
        });

        return {
            totalGRNs,
            totalNetWeight: parseFloat(totalNetWeight.toFixed(2)),
            totalGrossWeight: parseFloat(totalGrossWeight.toFixed(2)),
            totalAmount: parseFloat(totalAmount.toFixed(2)),
            averageNetWeightPerGRN:
                totalGRNs > 0 ? parseFloat((totalNetWeight / totalGRNs).toFixed(2)) : 0,
            averageAmountPerGRN:
                totalGRNs > 0 ? parseFloat((totalAmount / totalGRNs).toFixed(2)) : 0,
        };
    }
}
