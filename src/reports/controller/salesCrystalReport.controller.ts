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
import * as fs from 'fs';
import * as path from 'path';
import { TYPES } from '../../types';
import { SalesCrystalReportService, SalesReportFilters } from '../service/salesCrystalReport.service';
import logger from '../../utils/logger';
import AppError from '../../utils/appError';

@controller('/sales-reports')
export class SalesCrystalReportController {
    private reportsDir: string;

    constructor(
        @inject(TYPES.SalesCrystalReportService)
        private salesReportService: SalesCrystalReportService
    ) {
        // Create reports directory if it doesn't exist
        this.reportsDir = path.join(process.cwd(), 'reports', 'sales');
        if (!fs.existsSync(this.reportsDir)) {
            fs.mkdirSync(this.reportsDir, { recursive: true });
        }
    }

    /**
     * Helper method to save workbook locally and send to client
     */
    private async saveAndSendWorkbook(
        workbook: ExcelJS.Workbook,
        fileName: string,
        res: Response
    ): Promise<void> {
        // Save to local directory
        const localFilePath = path.join(this.reportsDir, fileName);
        await workbook.xlsx.writeFile(localFilePath);
        logger.info(`Report saved locally: ${localFilePath}`);

        // Send to client
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();
    }

    /**
     * Get detailed sales report with pagination
     * GET /sales-reports/detailed
     */
    @httpGet('/detailed')
    public async getDetailedSalesReport(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                customerId: req.query.customerId as string,
                productId: req.query.productId as string,
                productCategoryId: req.query.productCategoryId as string,
                productSubCategoryId: req.query.productSubCategoryId as string,
                branchId: req.query.branchId as string,
                companyId: req.query.companyId as string,
                fromLocationId: req.query.fromLocationId as string,
                toLocationId: req.query.toLocationId as string,
                driverName: req.query.driverName as string,
                vehicleNo: req.query.vehicleNo as string,
                approvalStatus: req.query.approvalStatus as string,
                challanNo: req.query.challanNo as string,
                grnNo: req.query.grnNo as string,
                poNumber: req.query.poNumber as string,
                amountEqual: req.query.amountEqual ? Number(req.query.amountEqual) : undefined,
                amountGreaterThan: req.query.amountGreaterThan ? Number(req.query.amountGreaterThan) : undefined,
                amountLessThan: req.query.amountLessThan ? Number(req.query.amountLessThan) : undefined,
                amountGreaterThanOrEqual: req.query.amountGreaterThanOrEqual ? Number(req.query.amountGreaterThanOrEqual) : undefined,
                amountLessThanOrEqual: req.query.amountLessThanOrEqual ? Number(req.query.amountLessThanOrEqual) : undefined,
                netWeightEqual: req.query.netWeightEqual ? Number(req.query.netWeightEqual) : undefined,
                netWeightGreaterThan: req.query.netWeightGreaterThan ? Number(req.query.netWeightGreaterThan) : undefined,
                netWeightLessThan: req.query.netWeightLessThan ? Number(req.query.netWeightLessThan) : undefined,
                netWeightGreaterThanOrEqual: req.query.netWeightGreaterThanOrEqual ? Number(req.query.netWeightGreaterThanOrEqual) : undefined,
                netWeightLessThanOrEqual: req.query.netWeightLessThanOrEqual ? Number(req.query.netWeightLessThanOrEqual) : undefined,
                grossWeightEqual: req.query.grossWeightEqual ? Number(req.query.grossWeightEqual) : undefined,
                grossWeightGreaterThan: req.query.grossWeightGreaterThan ? Number(req.query.grossWeightGreaterThan) : undefined,
                grossWeightLessThan: req.query.grossWeightLessThan ? Number(req.query.grossWeightLessThan) : undefined,
                grossWeightGreaterThanOrEqual: req.query.grossWeightGreaterThanOrEqual ? Number(req.query.grossWeightGreaterThanOrEqual) : undefined,
                grossWeightLessThanOrEqual: req.query.grossWeightLessThanOrEqual ? Number(req.query.grossWeightLessThanOrEqual) : undefined,
            };
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;

            const result = await this.salesReportService.getDetailedSalesReport(
                filters,
                page,
                limit
            );

            logger.info('Detailed sales report generated successfully', {
                recordCount: result.data.length,
                total: result.total,
                page,
                filters,
            });

            res.status(200).json({
                status: 'success',
                data: result.data,
                meta: {
                    total: result.total,
                    pages: result.pages,
                    currentPage: page,
                    limit,
                    generatedAt: new Date().toISOString(),
                    filters,
                },
            });
        } catch (error) {
            logger.error('Error generating detailed sales report:', error);
            next(new AppError(500, 'Failed to generate sales report'));
        }
    }

    /**
     * Get sales summary report
     * GET /sales-reports/summary
     */
    @httpGet('/summary')
    public async getSalesSummary(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                customerId: req.query.customerId as string,
                productId: req.query.productId as string,
                companyId: req.query.companyId as string,
            };

            const summaryData = await this.salesReportService.getSalesSummary(filters);

            logger.info('Sales summary report generated successfully');

            res.status(200).json({
                status: 'success',
                data: summaryData,
                meta: {
                    generatedAt: new Date().toISOString(),
                    filters,
                },
            });
        } catch (error) {
            logger.error('Error generating sales summary:', error);
            next(new AppError(500, 'Failed to generate sales summary'));
        }
    }

    /**
     * Get customer drill-down report
     * GET /sales-reports/customer/:customerId
     */
    @httpGet('/customer/:customerId')
    public async getCustomerDrillDown(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const { customerId } = req.params;
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                customerId: customerId,
            };

            const result = await this.salesReportService.getCustomerDrillDown(
                customerId,
                filters
            );

            logger.info('Customer drill-down report generated successfully', {
                customerId,
                recordCount: result.data.length,
            });

            res.status(200).json({
                status: 'success',
                data: result.data,
                meta: {
                    total: result.total,
                    customerId,
                    generatedAt: new Date().toISOString(),
                },
            });
        } catch (error) {
            logger.error('Error generating customer drill-down report:', error);
            next(new AppError(500, 'Failed to generate customer drill-down report'));
        }
    }

    /**
     * Get product drill-down report
     * GET /sales-reports/product/:productId
     */
    @httpGet('/product/:productId')
    public async getProductDrillDown(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const { productId } = req.params;
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                productId: productId,
            };

            const result = await this.salesReportService.getProductDrillDown(
                productId,
                filters
            );

            logger.info('Product drill-down report generated successfully', {
                productId,
                recordCount: result.data.length,
            });

            res.status(200).json({
                status: 'success',
                data: result.data,
                meta: {
                    total: result.total,
                    productId,
                    generatedAt: new Date().toISOString(),
                },
            });
        } catch (error) {
            logger.error('Error generating product drill-down report:', error);
            next(new AppError(500, 'Failed to generate product drill-down report'));
        }
    }

    /**
     * Export detailed sales report to Excel
     * GET /sales-reports/export/excel
     */
    @httpGet('/export/excel')
    public async exportToExcel(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                customerId: req.query.customerId as string,
                productId: req.query.productId as string,
                companyId: req.query.companyId as string,
                approvalStatus: req.query.approvalStatus as string,
            };

            const result = await this.salesReportService.getDetailedSalesReport(
                filters,
                1,
                10000
            );

            // Create Excel workbook
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Sales Report');

            // Add title
            worksheet.mergeCells('A1:R1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = 'Sales Report - Customer Delivery Challans';
            titleCell.font = { size: 16, bold: true };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
            titleCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4472C4' },
            };
            titleCell.font = { ...titleCell.font, color: { argb: 'FFFFFFFF' } };

            // Add filter info
            worksheet.mergeCells('A2:R2');
            const filterCell = worksheet.getCell('A2');
            filterCell.value = `Period: ${filters.startDate ? format(filters.startDate, 'dd-MM-yyyy') : 'All'} to ${filters.endDate ? format(filters.endDate, 'dd-MM-yyyy') : 'All'}`;
            filterCell.alignment = { horizontal: 'center' };

            // Add generated at info
            worksheet.mergeCells('A3:R3');
            const generatedCell = worksheet.getCell('A3');
            generatedCell.value = `Generated At: ${format(new Date(), 'dd-MM-yyyy hh:mm:ss a')}`;
            generatedCell.alignment = { horizontal: 'center' };
            generatedCell.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
            generatedCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF0F0F0' },
            };

            // Add headers
            const headers = [
                'Challan No',
                'Challan Date',
                'Customer Name',
                'Customer Code',
                'PO Number',
                'Product Name',
                'Product Code',
                'Variant',
                'Category',
                'Net Weight (KG)',
                'Packing Material Weight (KG)',
                'Unit Price',
                'Amount',
                'UOM',
                'From Location',
                'Driver Name',
                'Vehicle No',
                'Approval Status',
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

            result.data.forEach((dc) => {
                if (dc.products && dc.products.length > 0) {
                    dc.products.forEach((product) => {
                        const row = worksheet.addRow([
                            dc.challanNo,
                            dc.challanDate,
                            dc.customerName,
                            dc.customerCode,
                            dc.poNumber,
                            product.productName,
                            product.productCode,
                            product.variantName,
                            product.category,
                            product.netWeight,
                            product.packingMaterialWeight,
                            product.unitPrice,
                            product.amount,
                            product.uom,
                            dc.fromLocation,
                            dc.driverName,
                            dc.vehicleNo,
                            dc.approvalStatus,
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
                'TOTAL:',
                totalNetWeight.toFixed(2),
                '',
                '',
                totalAmount.toFixed(2),
                '',
                '',
                '',
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

            // Freeze header rows (title, period, generated at, headers)
            worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

            // Save locally and send to client
            const fileName = `Sales_Report_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.xlsx`;
            await this.saveAndSendWorkbook(workbook, fileName, res);

            logger.info('Sales report exported to Excel successfully', {
                recordCount: result.data.length,
                fileName,
                savedTo: path.join(this.reportsDir, fileName),
            });
        } catch (error) {
            logger.error('Error exporting sales report to Excel:', error);
            next(new AppError(500, 'Failed to export sales report to Excel'));
        }
    }

    /**
     * Export sales summary to Excel
     * GET /sales-reports/export/summary-excel
     */
    @httpGet('/export/summary-excel')
    public async exportSummaryToExcel(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                customerId: req.query.customerId as string,
                companyId: req.query.companyId as string,
            };

            const summaryData = await this.salesReportService.getSalesSummary(filters);

            const workbook = new ExcelJS.Workbook();

            // Summary Sheet with enhanced styling
            const summarySheet = workbook.addWorksheet('Summary');

            // Title
            summarySheet.mergeCells('A1:D1');
            const titleRow = summarySheet.getCell('A1');
            titleRow.value = 'Sales Summary Report';
            titleRow.font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
            titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
            titleRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF0066CC' }
            };
            summarySheet.getRow(1).height = 30;

            // Generated At
            summarySheet.mergeCells('A2:D2');
            const genRow = summarySheet.getCell('A2');
            genRow.value = `Generated At: ${format(new Date(), 'dd-MM-yyyy hh:mm:ss a')}`;
            genRow.alignment = { horizontal: 'center' };
            genRow.font = { italic: true, size: 10 };

            summarySheet.addRow([]);

            // Key Metrics with styling
            const metricsStartRow = 4;
            const metrics = [
                ['Metric', 'Value'],
                ['Total Delivery Challans', summaryData.totalDeliveryChallans],
                ['Total Sales Amount (₹)', summaryData.totalSalesAmount.toFixed(2)],
                ['Total Net Weight (KG)', summaryData.totalNetWeight.toFixed(2)],
                ['Total Gross Weight (KG)', summaryData.totalGrossWeight.toFixed(2)],
                ['Average Order Value (₹)', summaryData.averageOrderValue.toFixed(2)],
                ['Average Net Weight per DC (KG)', summaryData.averageNetWeightPerDC.toFixed(2)]
            ];

            metrics.forEach((metric, index) => {
                const row = summarySheet.addRow(metric);
                if (index === 0) {
                    // Header row
                    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    row.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF4472C4' }
                    };
                } else {
                    // Data rows with alternating colors
                    row.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: index % 2 === 0 ? 'FFF0F0F0' : 'FFFFFFFF' }
                    };
                    // Format numbers in column B
                    if (row.getCell(2).value) {
                        row.getCell(2).numFmt = '#,##0.00';
                    }
                }
                row.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                });
            });

            // Auto-fit columns
            summarySheet.getColumn(1).width = 35;
            summarySheet.getColumn(2).width = 20;

            // Top Customers Sheet with enhanced styling
            const customersSheet = workbook.addWorksheet('Top Customers');

            // Header row
            const custHeaderRow = customersSheet.addRow(['Customer Name', 'Customer Code', 'Total Amount', 'Total Net Weight', 'DC Count', 'Avg Order Value']);
            custHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            custHeaderRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF0066CC' }
            };
            custHeaderRow.height = 25;
            custHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

            // Data rows
            summaryData.topCustomersByValue.forEach((customer, index) => {
                const row = customersSheet.addRow([
                    customer.customerName,
                    customer.customerCode,
                    customer.totalAmount,
                    customer.totalNetWeight,
                    customer.dcCount,
                    customer.averageOrderValue,
                ]);

                // Apply alternating row colors only to cells with data (columns 1-6)
                if (index % 2 === 0) {
                    for (let col = 1; col <= 6; col++) {
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF0F8FF' }
                        };
                    }
                }

                // Format numbers
                row.getCell(3).numFmt = '₹#,##0.00';
                row.getCell(4).numFmt = '#,##0.00';
                row.getCell(6).numFmt = '₹#,##0.00';

                // Highlight top 3 customers
                if (index < 3) {
                    row.getCell(1).font = { bold: true };
                    row.getCell(1).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: index === 0 ? 'FFFFD700' : index === 1 ? 'FFC0C0C0' : 'FFCD7F32' }
                    };
                }
            });

            // Auto-fit columns
            customersSheet.columns.forEach((column, index) => {
                if (column) {
                    column.width = index === 0 ? 30 : 18;
                }
            });

            // Top Products Sheet with enhanced styling
            const productsSheet = workbook.addWorksheet('Top Products');

            // Header row
            const prodHeaderRow = productsSheet.addRow(['Product Name', 'Product Code', 'Total Net Weight', 'Total Amount', 'Avg Price']);
            prodHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            prodHeaderRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF28A745' }
            };
            prodHeaderRow.height = 25;
            prodHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

            // Data rows
            summaryData.topProductsByQuantity.forEach((product, index) => {
                const row = productsSheet.addRow([
                    product.productName,
                    product.productCode,
                    product.totalNetWeight,
                    product.totalAmount,
                    product.averagePrice,
                ]);

                // Apply alternating row colors only to cells with data (columns 1-5)
                if (index % 2 === 0) {
                    for (let col = 1; col <= 5; col++) {
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF0FFF0' }
                        };
                    }
                }

                // Format numbers
                row.getCell(3).numFmt = '#,##0.00 "KG"';
                row.getCell(4).numFmt = '₹#,##0.00';
                row.getCell(5).numFmt = '₹#,##0.00';

                // Highlight top 3 products
                if (index < 3) {
                    row.getCell(1).font = { bold: true };
                }
            });

            // Auto-fit columns
            productsSheet.columns.forEach((column, index) => {
                if (column) {
                    column.width = index === 0 ? 30 : 18;
                }
            });

           

            // Driver Performance Sheet with enhanced styling
            const driversSheet = workbook.addWorksheet('Driver Performance');

            // Header row
            const driverHeaderRow = driversSheet.addRow(['Driver Name', 'Total Deliveries', 'Total Amount', 'Total Net Weight', 'Avg Delivery Value']);
            driverHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            driverHeaderRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF6F42C1' }
            };
            driverHeaderRow.height = 25;
            driverHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

            // Data rows
            summaryData.driverPerformance.forEach((driver, index) => {
                const row = driversSheet.addRow([
                    driver.driverName,
                    driver.totalDeliveries,
                    driver.totalAmount,
                    driver.totalNetWeight,
                    driver.averageDeliveryValue,
                ]);

                // Apply alternating row colors only to cells with data (columns 1-5)
                if (index % 2 === 0) {
                    for (let col = 1; col <= 5; col++) {
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF3E5F5' }
                        };
                    }
                }

                // Format numbers
                row.getCell(3).numFmt = '₹#,##0.00';
                row.getCell(4).numFmt = '#,##0.00 "KG"';
                row.getCell(5).numFmt = '₹#,##0.00';

                // Highlight top 3 drivers with medals
                if (index < 3) {
                    row.getCell(1).font = { bold: true };
                    const medalColor = index === 0 ? 'FFFFD700' : index === 1 ? 'FFC0C0C0' : 'FFCD7F32';
                    row.getCell(1).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: medalColor }
                    };
                }
            });

            // Auto-fit columns
            driversSheet.columns.forEach((column, index) => {
                if (column) {
                    column.width = index === 0 ? 25 : 20;
                }
            });

            // Visual Dashboard removed - users can create native Excel charts from the data sheets
            // All visual chart data is available in separate sheets: Daily Trends, Monthly Trends, Yearly Trends, Custom Trends
 // Monthly Trends Sheet with enhanced styling
            const trendsSheet = workbook.addWorksheet('Monthly Trends');

            // Header row
            const trendHeaderRow = trendsSheet.addRow(['Month', 'Total Amount', 'Total Net Weight', 'DC Count']);
            trendHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            trendHeaderRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFF6B35' }
            };
            trendHeaderRow.height = 25;
            trendHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

            // Data rows with trend indicators
            summaryData.monthlyTrends.forEach((trend, index) => {
                const row = trendsSheet.addRow([
                    trend.month,
                    trend.totalAmount,
                    trend.totalNetWeight,
                    trend.dcCount,
                ]);

                // Apply alternating row colors only to cells with data (columns 1-4)
                if (index % 2 === 0) {
                    for (let col = 1; col <= 4; col++) {
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFFF5E6' }
                        };
                    }
                }

                // Format numbers
                row.getCell(2).numFmt = '₹#,##0.00';
                row.getCell(3).numFmt = '#,##0.00 "KG"';

                // Highlight current/recent month (only data columns)
                if (index === 0) {
                    for (let col = 1; col <= 4; col++) {
                        row.getCell(col).font = { bold: true };
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFFEB3B' }
                        };
                    }
                }
            });

            // Auto-fit columns
            trendsSheet.columns.forEach((column) => {
                if (column) {
                    column.width = 20;
                }
            });
            // ===== ADD DAILY TRENDS SHEET =====
            const dailyTrendsSheet = workbook.addWorksheet('Daily Trends');

            const dailyHeaderRow = dailyTrendsSheet.addRow(['Date', 'Total Amount', 'Total Net Weight', 'DC Count']);
            dailyHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            dailyHeaderRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF17A2B8' }
            };
            dailyHeaderRow.height = 25;
            dailyHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

            summaryData.dailyTrends.forEach((trend, index) => {
                const row = dailyTrendsSheet.addRow([
                    trend.date,
                    trend.totalAmount,
                    trend.totalNetWeight,
                    trend.dcCount,
                ]);

                if (index % 2 === 0) {
                    for (let col = 1; col <= 4; col++) {
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFE0F7FA' }
                        };
                    }
                }

                row.getCell(2).numFmt = '₹#,##0.00';
                row.getCell(3).numFmt = '#,##0.00 "KG"';

                // Highlight today
                if (index === 0) {
                    for (let col = 1; col <= 4; col++) {
                        row.getCell(col).font = { bold: true };
                    }
                }
            });

            dailyTrendsSheet.columns.forEach((column) => {
                if (column) {
                    column.width = 20;
                }
            });

            // ===== ADD YEARLY TRENDS SHEET =====
            const yearlyTrendsSheet = workbook.addWorksheet('Yearly Trends');

            const yearlyHeaderRow = yearlyTrendsSheet.addRow(['Year', 'Total Amount', 'Total Net Weight', 'DC Count']);
            yearlyHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            yearlyHeaderRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF6C757D' }
            };
            yearlyHeaderRow.height = 25;
            yearlyHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

            summaryData.yearlyTrends.forEach((trend, index) => {
                const row = yearlyTrendsSheet.addRow([
                    trend.year,
                    trend.totalAmount,
                    trend.totalNetWeight,
                    trend.dcCount,
                ]);

                if (index % 2 === 0) {
                    for (let col = 1; col <= 4; col++) {
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF8F9FA' }
                        };
                    }
                }

                row.getCell(2).numFmt = '₹#,##0.00';
                row.getCell(3).numFmt = '#,##0.00 "KG"';

                // Highlight current year
                if (index === 0) {
                    for (let col = 1; col <= 4; col++) {
                        row.getCell(col).font = { bold: true };
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFFC107' }
                        };
                    }
                }
            });

            yearlyTrendsSheet.columns.forEach((column) => {
                if (column) {
                    column.width = 20;
                }
            });

            // ===== ADD CUSTOM TRENDS SHEET =====
            const customTrendsSheet = workbook.addWorksheet('Custom Trends');

            const customHeaderRow = customTrendsSheet.addRow(['Period', 'Total Amount', 'Total Net Weight', 'DC Count', 'Group By']);
            customHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            customHeaderRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF9C27B0' }
            };
            customHeaderRow.height = 25;
            customHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

            summaryData.customTrends.forEach((trend, index) => {
                const row = customTrendsSheet.addRow([
                    trend.period,
                    trend.totalAmount,
                    trend.totalNetWeight,
                    trend.dcCount,
                    //trend.groupBy,
                ]);

                if (index % 2 === 0) {
                    for (let col = 1; col <= 5; col++) {
                        row.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF3E5F5' }
                        };
                    }
                }

                row.getCell(2).numFmt = '₹#,##0.00';
                row.getCell(3).numFmt = '#,##0.00 "KG"';

                // Highlight first period
                if (index === 0) {
                    for (let col = 1; col <= 5; col++) {
                        row.getCell(col).font = { bold: true };
                    }
                }
            });

            customTrendsSheet.columns.forEach((column) => {
                if (column) {
                    column.width = 20;
                }
            });

            const fileName = `Sales_Summary_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.xlsx`;
            await this.saveAndSendWorkbook(workbook, fileName, res);

            logger.info('Sales summary exported successfully', {
                fileName,
                savedTo: path.join(this.reportsDir, fileName),
            });
        } catch (error) {
            logger.error('Error exporting sales summary:', error);
            next(new AppError(500, 'Failed to export sales summary'));
        }
    }

    /**
     * Get customer returns report
     * GET /sales-reports/returns/detailed
     */
    @httpGet('/returns/detailed')
    public async getCustomerReturnsReport(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                customerId: req.query.customerId as string,
                companyId: req.query.companyId as string,
                branchId: req.query.branchId as string,
            };
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;

            const result = await this.salesReportService.getCustomerReturnsReport(
                filters,
                page,
                limit
            );

            logger.info('Customer returns report generated successfully', {
                recordCount: result.data.length,
                total: result.total,
            });

            res.status(200).json({
                status: 'success',
                data: result.data,
                meta: {
                    total: result.total,
                    pages: result.pages,
                    currentPage: page,
                    limit,
                    generatedAt: new Date().toISOString(),
                    filters,
                },
            });
        } catch (error) {
            logger.error('Error generating customer returns report:', error);
            next(new AppError(500, 'Failed to generate customer returns report'));
        }
    }

    /**
     * Get customer returns summary
     * GET /sales-reports/returns/summary
     */
    @httpGet('/returns/summary')
    public async getCustomerReturnsSummary(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                customerId: req.query.customerId as string,
                companyId: req.query.companyId as string,
            };

            const summaryData = await this.salesReportService.getCustomerReturnsSummary(filters);

            logger.info('Customer returns summary generated successfully');

            res.status(200).json({
                status: 'success',
                data: summaryData,
                meta: {
                    generatedAt: new Date().toISOString(),
                    filters,
                },
            });
        } catch (error) {
            logger.error('Error generating customer returns summary:', error);
            next(new AppError(500, 'Failed to generate customer returns summary'));
        }
    }

    /**
     * Export customer returns to Excel
     * GET /sales-reports/returns/export/excel
     */
    @httpGet('/returns/export/excel')
    public async exportReturnsToExcel(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filters: SalesReportFilters = {
                startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
                endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
                customerId: req.query.customerId as string,
                companyId: req.query.companyId as string,
            };

            const result = await this.salesReportService.getCustomerReturnsReport(
                filters,
                1,
                10000
            );

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Customer Returns');

            // Add title
            worksheet.mergeCells('A1:P1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = 'Customer Returns Report';
            titleCell.font = { size: 16, bold: true };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
            titleCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFDC143C' },
            };
            titleCell.font = { ...titleCell.font, color: { argb: 'FFFFFFFF' } };

            // Add filter info
            worksheet.mergeCells('A2:P2');
            const filterCell = worksheet.getCell('A2');
            filterCell.value = `Period: ${filters.startDate ? format(filters.startDate, 'dd-MM-yyyy') : 'All'} to ${filters.endDate ? format(filters.endDate, 'dd-MM-yyyy') : 'All'}`;
            filterCell.alignment = { horizontal: 'center' };

            // Add generated at info
            worksheet.mergeCells('A3:P3');
            const generatedCellReturns = worksheet.getCell('A3');
            generatedCellReturns.value = `Generated At: ${format(new Date(), 'dd-MM-yyyy hh:mm:ss a')}`;
            generatedCellReturns.alignment = { horizontal: 'center' };
            generatedCellReturns.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
            generatedCellReturns.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF0F0F0' },
            };

            // Add headers
            const headers = [
                'Return Date',
                'Customer Name',
                'Customer Code',
                'DC No',
                'Product Name',
                'Product Code',
                'Variant',
                'Returned Qty',
                'Returned Net Wt',
                'Returned Gross Wt',
                'Returned Amount',
                'Rejected Qty',
                'Rejected Net Wt',
                'Rejected Gross Wt',
                'Rejected Amount',
                'Remark',
            ];

            const headerRow = worksheet.addRow(headers);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF8B0000' },
            };
            headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
            headerRow.height = 25;

            // Add data rows
            let totalReturnedAmount = 0;
            let totalRejectedAmount = 0;

            result.data.forEach((ret) => {
                if (ret.returnedProducts && ret.returnedProducts.length > 0) {
                    ret.returnedProducts.forEach((product) => {
                        const row = worksheet.addRow([
                            ret.returnDate,
                            ret.customerName,
                            ret.customerCode,
                            ret.deliveryChallanNo,
                            product.productName,
                            product.productCode,
                            product.variantName,
                            product.returnedQty,
                            product.returnedNetWt,
                            product.returnedGrossWt,
                            product.returnedQtyAmt,
                            product.rejectedQty,
                            product.rejectedNetWt,
                            product.rejectedGrossWt,
                            product.rejectedQtyAmt,
                            ret.remark,
                        ]);

                        row.eachCell((cell) => {
                            cell.border = {
                                top: { style: 'thin' },
                                left: { style: 'thin' },
                                bottom: { style: 'thin' },
                                right: { style: 'thin' },
                            };
                        });

                        totalReturnedAmount += product.returnedQtyAmt;
                        totalRejectedAmount += product.rejectedQtyAmt;
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
                totalReturnedAmount.toFixed(2),
                '',
                '',
                '',
                totalRejectedAmount.toFixed(2),
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
            // Freeze header rows (title, period, generated at, headers)
            worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

            const fileName = `Customer_Returns_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.xlsx`;
            await this.saveAndSendWorkbook(workbook, fileName, res);

            logger.info('Customer returns exported to Excel successfully', {
                recordCount: result.data.length,
                fileName,
                savedTo: path.join(this.reportsDir, fileName),
            });
        } catch (error) {
            logger.error('Error exporting customer returns to Excel:', error);
            next(new AppError(500, 'Failed to export customer returns to Excel'));
        }
    }

    /**
     * Get list of saved reports
     * GET /sales-reports/saved
     */
    @httpGet('/saved')
    public async getSavedReports(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const files = fs.readdirSync(this.reportsDir);
            const reports = files
                .filter(file => file.endsWith('.xlsx'))
                .map(file => {
                    const filePath = path.join(this.reportsDir, file);
                    const stats = fs.statSync(filePath);
                    return {
                        fileName: file,
                        filePath: filePath,
                        size: stats.size,
                        createdAt: stats.birthtime,
                        modifiedAt: stats.mtime,
                    };
                })
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

            res.status(200).json({
                status: 'success',
                data: reports,
                meta: {
                    total: reports.length,
                    directory: this.reportsDir,
                },
            });
        } catch (error) {
            logger.error('Error fetching saved reports:', error);
            next(new AppError(500, 'Failed to fetch saved reports'));
        }
    }

    /**
     * Download a saved report
     * GET /sales-reports/saved/:fileName
     */
    @httpGet('/saved/:fileName')
    public async downloadSavedReport(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const { fileName } = req.params;
            const filePath = path.join(this.reportsDir, fileName);

            // Security check: ensure file is within reports directory
            if (!filePath.startsWith(this.reportsDir)) {
                return next(new AppError(403, 'Access denied'));
            }

            if (!fs.existsSync(filePath)) {
                return next(new AppError(404, 'Report not found'));
            }

            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

            const fileStream = fs.createReadStream(filePath);
            fileStream.pipe(res);

            logger.info('Saved report downloaded', { fileName });
        } catch (error) {
            logger.error('Error downloading saved report:', error);
            next(new AppError(500, 'Failed to download saved report'));
        }
    }

    /**
     * Delete a saved report
     * DELETE /sales-reports/saved/:fileName
     */
    @httpGet('/saved/delete/:fileName')
    public async deleteSavedReport(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const { fileName } = req.params;
            const filePath = path.join(this.reportsDir, fileName);

            // Security check: ensure file is within reports directory
            if (!filePath.startsWith(this.reportsDir)) {
                return next(new AppError(403, 'Access denied'));
            }

            if (!fs.existsSync(filePath)) {
                return next(new AppError(404, 'Report not found'));
            }

            fs.unlinkSync(filePath);

            logger.info('Saved report deleted', { fileName });

            res.status(200).json({
                status: 'success',
                message: 'Report deleted successfully',
            });
        } catch (error) {
            logger.error('Error deleting saved report:', error);
            next(new AppError(500, 'Failed to delete saved report'));
        }
    }

    /**
     * Get available filter options
     * GET /sales-reports/filters
     */
    @httpGet('/filters')
    public async getFilterOptions(
        @request() req: Request,
        @response() res: Response,
        @next() next: NextFunction
    ) {
        try {
            const filterOptions = {
                approvalStatuses: ['pending', 'approved', 'rejected'],
                note: 'Use customerId, productId, categoryId, etc. for filtering',
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
}
