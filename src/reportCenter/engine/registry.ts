import { purchaseRegister } from '../definitions/purchase/p1PurchaseRegister';
import { supplierScorecard } from '../definitions/purchase/p2SupplierScorecard';
import { productPurchaseAnalysis } from '../definitions/purchase/p3ProductPurchase';
import { procurementFunnel } from '../definitions/purchase/p4ProcurementFunnel';
import { payablesAgeing } from '../definitions/purchase/p5Payables';
import { purchasePaymentRegister } from '../definitions/purchase/p6PaymentRegister';
import { landedCost } from '../definitions/purchase/p7LandedCost';
import { grnEditHistory } from '../definitions/purchase/p8GrnEditHistory';
import { supplierStatement } from '../definitions/purchase/p9SupplierStatement';
import { salesRegister } from '../definitions/sales/s1SalesRegister';
import { customerAnalysis } from '../definitions/sales/s2CustomerAnalysis';
import { productSalesAnalysis } from '../definitions/sales/s3ProductSales';
import { receivablesAgeing } from '../definitions/sales/s4Receivables';
import { collectionRegister } from '../definitions/sales/s5CollectionRegister';
import { returnsRejections } from '../definitions/sales/s6Returns';
import { uninvoicedDeliveries } from '../definitions/sales/s7Uninvoiced';
import { directVsStockSales } from '../definitions/sales/s8DirectVsStock';
import { customerStatement } from '../definitions/sales/s9CustomerStatement';
import { ReportDefinition } from '../reportCenter.types';

/** Every report, in catalogue order (docs/reports-plan.md §4). */
export const REPORTS: ReportDefinition[] = [
  purchaseRegister,
  supplierScorecard,
  productPurchaseAnalysis,
  procurementFunnel,
  payablesAgeing,
  purchasePaymentRegister,
  landedCost,
  grnEditHistory,
  supplierStatement,
  salesRegister,
  customerAnalysis,
  productSalesAnalysis,
  receivablesAgeing,
  collectionRegister,
  returnsRejections,
  uninvoicedDeliveries,
  directVsStockSales,
  customerStatement,
];

const byKey = new Map(REPORTS.map((r) => [r.key, r]));

export const findReport = (key: string) => byKey.get(key);
