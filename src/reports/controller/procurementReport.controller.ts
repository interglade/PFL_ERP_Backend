import { controller, httpGet, next, request, requestParam, response, } from "inversify-express-utils";

import { inject } from "inversify";

import { NextFunction, Request, Response } from "express";

import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";
import { deserializeUser, requireUser } from "../../middleware/deserializeUser";
import { TYPES } from "../../types";
import { ProcurementTargetService as ProcurementReportService } from "../../procurementTarget/service/procurementTarget.service";

@controller("/procurement-report",
  deserializeUser,
  requireUser)
export class ProcurementReportController {
  constructor(@inject(TYPES.ProcurementTargetService) private readonly procurementReportService: ProcurementReportService) { }

  @httpGet('/:employeeId')
  async getProcurementReport(
    @requestParam('employeeId') employeeId: string,
    @request() req: Request,
    @response() res: Response
  ) {
    const { startDate, endDate, company, location,vendor,farmer,product } = req.query;

    const data = await this.procurementReportService.getProcurementReport({
      employeeId,
      startDate: new Date(startDate as string),
      endDate: new Date(endDate as string),
      company: company as string,
      location: location as string,
      vendor:vendor as string,
      farmer:farmer as string,
      product:product as string
    });

    return res.json({
      message: 'Procurement report fetched successfully',
      data,
    });
  }

  //TODO:Generate procurement Report excel
  @httpGet("/excel/generate/:employeeId")
  public async generateExcel(
    @requestParam("employeeId") employeeId: string,
    @request() req: Request,
    @response() res: Response,
    @next() nextFn: NextFunction
  ) {
    try {
      const { startDate, endDate, company, location, vendor, farmer, product } = req.query;

      const report = await this.procurementReportService.getProcurementReport({
        employeeId,
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string),
        company: company as string,
        location: location as string,
        vendor: vendor as string,
        farmer: farmer as string,
        product: product as string
      });

      const workbook = new ExcelJS.Workbook();

      /* =====================================================
         COMMON HELPERS
      ===================================================== */

      const normalize = (v?: string) => v?.trim().toLowerCase();
      
      const buildProductSheet = (
        sheetName: string,
        records: any[],
        baseHeaders: string[],
        productGetter: (r: any) => any[],
        rowBuilder: (r: any) => any[],
        subCols: string[]
      ) => {
        const productMap = new Map<string, string>();

        records.forEach(r => {
          productGetter(r)?.forEach(p => {
            const key = normalize(p.productName?.name);
            if (key && !productMap.has(key)) {
              productMap.set(key, p.productName.name);
            }
          });
        });

        const products = Array.from(productMap.entries()).map(
          ([key, name]) => ({ key, name })
        );

        const worksheet = workbook.addWorksheet(sheetName);

        /* ================= HEADERS ================= */

        const header1Row = worksheet.addRow([]);
        const header2Row = worksheet.addRow([]);

        // Add base headers
        baseHeaders.forEach((header, index) => {
          header1Row.getCell(index + 1).value = header;
          header2Row.getCell(index + 1).value = header;
          
          // Merge cells vertically for base headers
          worksheet.mergeCells(1, index + 1, 2, index + 1);
          
          // Style base headers
          const cell = header1Row.getCell(index + 1);
          cell.font = { bold: true };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFBDD7EE' }
          };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });

        // Add product headers
        let colIndex = baseHeaders.length + 1;
        products.forEach(p => {
          const startCol = colIndex;
          const endCol = colIndex + subCols.length - 1;
          
          // Product name in first row
          header1Row.getCell(startCol).value = p.name;
          worksheet.mergeCells(1, startCol, 1, endCol);
          
          const productCell = header1Row.getCell(startCol);
          productCell.font = { bold: true };
          productCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFBDD7EE' }
          };
          productCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          productCell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          
          // Sub columns in second row
          subCols.forEach((subCol, subIndex) => {
            const cell = header2Row.getCell(startCol + subIndex);
            cell.value = subCol;
            cell.font = { bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE2EFDA' }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
          
          colIndex = endCol + 1;
        });

        /* ================= DATA ROWS ================= */

        records.forEach(r => {
          const rowData: any[] = [...rowBuilder(r)];

          const lookup = new Map<string, any>();
          productGetter(r)?.forEach(p => {
            const key = normalize(p.productName?.name);
            if (key) lookup.set(key, p);
          });

          products.forEach(p => {
            const prod = lookup.get(p.key);

            subCols.forEach(col => {
              let value = null;

              if (prod) {
                switch (col) {
                  case "Quantity":
                    value = prod.quantity ?? prod.netWeight ?? null;
                    break;

                  case "Unit Price":
                    value = prod.unitPrice ?? null;
                    break;

                  case "Amount":
                    value = prod.amount ?? null;
                    break;

                  default:
                    value = null;
                }
              }

              rowData.push(value);
            });
          });

          const dataRow = worksheet.addRow(rowData);
          
          // Style data cells
          dataRow.eachCell((cell) => {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        });

        // Auto-fit columns
        worksheet.columns.forEach(column => {
          column.width = 15;
        });
      };

      /* =====================================================
         RFPA SHEET
      ===================================================== */

      buildProductSheet(
        "RFPA",
        report.rfpa.documents,
        ["RFPA No", "Source", "Vendor company", "Farmer Name", "Created Date"],
        r => r.rfpaProducts,
        r => [
          r.rfpaId,
          r.source,
          r.selectedVendor?.companyName || null,
          r.selectedFarmer
            ? `${r.selectedFarmer.farmerfName} ${r.selectedFarmer.farmerlName}`
            : null,
          r.createdAt.toISOString().split('T')[0],
        ],
        ["Quantity", "Unit Price", "Amount"]
      );

      /* =====================================================
         DEAL SLIP SHEET
      ===================================================== */

      buildProductSheet(
        "Deal Slip",
        report.dealSlip.documents,
        ["Deal Slip NO", "RFPA ID", "Source", "Vendor company", "Farmer Name", "Created Date"],
        r => r.rfpa?.rfpaProducts,
        r => [
          r.dealSlipNo,
          r.rfpa?.rfpaId || null,
          r.rfpa?.source || null,
          r.rfpa?.selectedVendor?.companyName || null,
          r.rfpa?.selectedFarmer
            ? `${r.rfpa.selectedFarmer.farmerfName} ${r.rfpa.selectedFarmer.farmerlName}`
            : null,
          r.createdAt.toISOString().split('T')[0],
        ],
        ["Quantity", "Unit Price", "Amount"]
      );

      /* =====================================================
         GRN SHEET
      ===================================================== */

      buildProductSheet(
        "GRN",
        report.grn.documents,
        ["GRN NO", "Source", "Vendor company", "Farmer Name", "Created Date"],
        r => r.grnProducts,
        r => [
          r.grnNo,
          r.source,
          r.selectedVendor?.companyName || null,
          r.selectedFarmer
            ? `${r.selectedFarmer.farmerfName} ${r.selectedFarmer.farmerlName}`
            : null,
          r.createdAt.toISOString().split('T')[0],
        ],
        ["Quantity", "Unit Price", "Amount"]
      );

      /* =====================================================
         TARGET vs ACHIEVEMENT (STYLED)
      ===================================================== */

      const targetSheet = workbook.addWorksheet("Target vs Achievement");

      const targetData = [
        ["Metric", "Value"],
        ["Target Quantity", report.targetvsachievement.targetQty],
        ["Achieved Quantity", report.targetvsachievement.achievedQty],
        [
          "Achievement %",
          `${report.targetvsachievement.achievementPercentage}%`,
        ],
      ];

      targetData.forEach((rowData, rowIndex) => {
        const row = targetSheet.addRow(rowData);
        
        row.eachCell((cell, colNumber) => {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };

          // Header row
          if (rowIndex === 0) {
            cell.font = { bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFBDD7EE' }
            };
          }

          // Label column
          if (colNumber === 1 && rowIndex > 0) {
            cell.font = { bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE2EFDA' }
            };
          }
        });
      });

      // Set column widths
      targetSheet.getColumn(1).width = 30;
      targetSheet.getColumn(2).width = 20;

      /* =====================================================
         SAVE FILE
      ===================================================== */

      const dir = path.join(__dirname, "../../uploads/procurements");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const filePath = path.join(
        dir,
        `procurement_report_${Date.now()}.xlsx`
      );

      await workbook.xlsx.writeFile(filePath);

      return res.status(200).json({
        message: "Excel generated successfully",
        filePath,
      });
    } catch (error) {
      nextFn(error);
    }
  }

}