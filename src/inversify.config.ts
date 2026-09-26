import { Container } from "inversify";

import { UserRepository } from "./employee/repository/user.repository";
import { TYPES } from "./types";
import { DataSource } from "typeorm";
import { FileController } from "./file/file.controller";
import { UserController } from "./employee/controller/user.controller";
import { UserService } from "./employee/service/user.service";
import { Role, User } from "./employee/entity/user.entity";
import { AuthController } from "./auth/controller/auth.controller";
import { AddressRepository } from "./address/repository/address.repository";
import { Address } from "./address/entity/address.entity";
import { AddressController } from "./address/controller/address.controller";
import { AddressService } from "./address/service/address.service";
import { VendorCategoryRepository } from "./vendor/vendorCategory/repository/vendorCategory.repository";
import { VendorCategory } from "./vendor/vendorCategory/entity/vendorCategory.entity";
import { VendorCategoryController } from "./vendor/vendorCategory/controller/vendorCategory.controller";
import { VendorCategoryService } from "./vendor/vendorCategory/service/vendorCategory.service";
import { VendorSubcategoryService } from "./vendor/vendorSubcategory/service/vendorSubcategory.service";
import { VendorSubcategoryRepository } from "./vendor/vendorSubcategory/repository/vendorSubcategory.repository";
import { VendorSubcategory } from "./vendor/vendorSubcategory/entity/vendorSubcategory.entity";
import { VendorSubcategoryController } from "./vendor/vendorSubcategory/controller/vendorSubcategory.controller";
import { VendorService } from "./vendor/createVendor/service/vendor.service";
import { VendorRepository } from "./vendor/createVendor/repository/vendor.repository";
import { Vendor } from "./vendor/createVendor/entity/vendor.entity";
import { VendorController } from "./vendor/createVendor/controller/vendor.controller";
import { CustomerService } from "./customer/addcustomer/service/customer.service";
import { CustomerTypeService } from "./customer/customerType/service/customerType.service";
import { CustomerController } from "./customer/addcustomer/controller/customer.controller";
import { Customer } from "./customer/addcustomer/entity/customer.entity";
import { CustomerRepository } from "./customer/addcustomer/repository/customer.repository";
import { CustomerTypeRepository } from "./customer/customerType/repository/customerType.repository";
import { CustomerTypeController } from "./customer/customerType/controller/customerType.controller";
import { CustomerCategoryService } from "./customer/customerCategory/service/customerCategory.service";
import { CustomerCategoryRepository } from "./customer/customerCategory/repository/customerCategory.repository";
import { CustomerCategoryController } from "./customer/customerCategory/controller/customerCategory.controller";
import { FarmerService } from "./farmer/service/farmer.service";
import { FarmerRepository } from "./farmer/repository/farmer.repository";
import { Farmer } from "./farmer/entity/farmer.entity";
import { FarmerController } from "./farmer/controller/farmer.controller";
import { CropRepository } from "./farmer/repository/crop.repository";
import { Crop } from "./farmer/entity/crop.entity";
import { UOMConversionMatrixService } from "./uomMatrix/service/UOMconversionMatrix.service";
import { UOMConversionMatrixRepository } from "./uomMatrix/repository/uomMatrix.repository";
import { UOMConversionMatrixController } from "./uomMatrix/controller/UOMconversionMatrix.controller";
import { UOMRepository } from "./uom/repository/uom.repository";
import { UOM } from "./uom/entity/uom.entity";
import { UOMService } from "./uom/service/UOM.service";
import { UOMController } from "./uom/controller/UOM.controller";
import { ProductCategoryService } from "./product/productCategory/service/product_category.service";
import { ProductCategoryRepository } from "./product/productCategory/repository/product_category.repository";
import { ProductCategory } from "./product/productCategory/entity/product_category.entity";
import { ProductCategoryController } from "./product/productCategory/controller/productCategory.controller";
import { ProductSubcategoryService } from "./product/productSubcategory/service/product_subcategory.service";
import { ProductSubcategoryRepository } from "./product/productSubcategory/repository/product_subcategory.repository";
import { ProductSubcategoryController } from "./product/productSubcategory/controller/productSubcategory.controller";
import { ProductService } from "./product/createproduct/service/product.service";
import { Product } from "./product/createproduct/entity/product.entity";
import { ProductRepository } from "./product/createproduct/repository/product.repository";
import { ProductController } from "./product/createproduct/controller/product.controller";
import { DriversService } from "./driver/service/driver.service";
import { DriverRepository } from "./driver/repository/driver.repository";
import { DriverController } from "./driver/controller/drivers.controller";
import { ProductClassificationService} from "./product/productClassification/service/product_classification.service";
import { ProductClassificationController } from "./product/productClassification/controller/productClassification.controller";
import { ProductClassificationRepository } from "./product/productClassification/repository/product_classification.repository";
import { ProductClassification } from "./product/productClassification/entity/product_classification.entity";
import { BankDetailsCustRepository } from "./customer/addcustomer/repository/bank-detailsCust.repository";
import { BankDetailsCust } from "./customer/addcustomer/entity/bankDetailsCust.entity";
import { BillingDetailsCustRepository } from "./customer/addcustomer/repository/billingDetailsCust.repository";
import { BillingDetailsCust } from "./customer/addcustomer/entity/billingdetailsCust.entity";
import { BranchessRepository } from "./branch/repository/branches.repository";
import { Branches } from "./branch/entity/branches.entity";
import { BranchessService } from "./branch/service/branches.service";
import { BranchessController } from "./branch/controller/branches.controller";
import { OfficesRepository } from "./office/repository/offices.repository";
import { AppDataSource } from "./utils/data-source";
import { OfficesData } from "./office/entity/offices.entity";
import { OfficesService } from "./office/service/office.service";
import { OfficesController } from "./office/controller/offices.controller";
import { DeliveryDetailsCustRepository } from "./customer/addcustomer/repository/deliveryDetailsCust.repository";
import { DeliveryDetails } from "./customer/addcustomer/entity/deliveryDetailsCust.entity";
import { StatutoryDetailsCustRepository } from "./customer/addcustomer/repository/statutoryDetails.repository";
import { StatutoryDetails } from "./customer/addcustomer/entity/statutoryCust.entity";
import { PaymentTermsRepository } from "./customer/addcustomer/repository/paymentTermsCust.repository";
import { PaymentTerms } from "./customer/addcustomer/entity/paymentDetailsCust.entity";
import { PaymentTermsService } from "./customer/addcustomer/service/paymentTerms.service";
import { ProductSpecificationCustRepository } from "./customer/addcustomer/repository/productspecification.repository";
import { ProductSpecification } from "./customer/addcustomer/entity/productSpecificationCust.entity";
import { KeyMobileNoDataRepository } from "./customer/addcustomer/repository/keyMobileNoDataCust.repository";
import { keyMobileNoData } from "./customer/addcustomer/entity/keyMobileNoCust.entity";
import { KeyMobileNoDataService } from "./customer/addcustomer/service/keymobilenocust.service";
import { BankDetailsvendRepository } from "./vendor/createVendor/repository/vendorBankDetails.repository";
import { BankDetailsvend } from "./vendor/createVendor/entity/bankDetailsVend.entity";
import { BankDetailsvendService } from "./vendor/createVendor/service/vendorBankDetails.service";
import { VendorSaleInfoRepository } from "./vendor/createVendor/repository/vendorSaleInfo.repository";
import { VendorSaleInfo } from "./vendor/createVendor/entity/vendorsaleinfo.entity";
import { VendorSaleInfoService } from "./vendor/createVendor/service/vendorsaleinfo.service";
import { RfpaRepository } from "./rfpa/repository/rfpa.repository";
import { RFPA } from "./rfpa/entity/rfpa.entity";
import { RfpaService } from "./rfpa/service/rfpa.service";
import { RfpaController } from "./rfpa/controller/rfpa.controller";
import { DealSlip } from "./dealSlip/entity/dealSlip.entity";
import { DealSlipRepository } from "./dealSlip/repository/dealSlip.repository";
import { DealSlipService } from "./dealSlip/service/dealSlip.service";
import { DealSlipController } from "./dealSlip/controller/dealSlip.controller";
import { GrnRepository } from "./grn/repository/grn.repository";
import { GRN } from "./grn/entity/grn.entity";
import { GrnService } from "./grn/service/grn.service";
import { GrnController } from "./grn/controller/grn.controller";
import { GrnReportService } from "./reports/service/grnReport.service";
import { GrnReportController } from "./reports/controller/grnReport.controller";
import { DeliveryChallanReportService } from "./reports/service/deliveryChallanReport.service";
import { DeliveryChallanReportController } from "./reports/controller/deliveryChallanReport.controller";
import { GrnProductRepository } from "./grn/repository/grnProduct.repository";
import { GrnProduct } from "./grn/entity/grnProduct.entity";
import { GrnProductService } from "./grn/service/grnProduct.service";
import { NotificationRepository } from "./notification/repository/notification.repository";
import { NotificationService } from "./notification/service/notification.service";
import { NotificationController } from "./notification/controller/notification.controller";
import { Notification as NotificationEntity } from "./notification/entity/notifications.entity";
import { TPVoucherRepository } from "./vouchers/tranportPaymentV/repository/transportPaymentV.repository";
import { TPVoucher } from "./vouchers/tranportPaymentV/entity/transportPaymentvoucher.entity";
import { TPVoucherService } from "./vouchers/tranportPaymentV/service/transportPaymentV.service";
import { TPVoucherController } from "./vouchers/tranportPaymentV/controller/transportPaymentV.controller";
import { PMPVoucherRepository } from "./vouchers/paymentMaterialV/repository/pmpvoucher.repository";
import { PMPVoucher } from "./vouchers/paymentMaterialV/entity/packingMaterialVoucher.entity";
import { PMPVoucherService } from "./vouchers/paymentMaterialV/service/pmpvoucher.service";
import { PMPVoucherController } from "./vouchers/paymentMaterialV/controller/pmpVoucher.controller";
import { MultiCashVoucherRepository } from "./vouchers/multiCashV/repository/multicashVoucher.repository";
import { CashVoucher } from "./vouchers/multiCashV/entity/mCashVoucher.entity";
import { MultiCashVoucherService } from "./vouchers/multiCashV/service/multiCashVoucher.service";
import { MultiCashVoucherController } from "./vouchers/multiCashV/controller/multiCashVoucher.controller";
import { LabourPaymentVoucherRepository } from "./vouchers/labourPaymentV/repository/labourPaymentVoucher.repository";
import { LPVoucher } from "./vouchers/labourPaymentV/entity/labourPaymentVoucher.entity";
import { LabourPaymentVoucherService } from "./vouchers/labourPaymentV/service/labourPaymentVoucher.service";
import { LabourPaymentVoucherController } from "./vouchers/labourPaymentV/controller/labourPaymentVoucher.controller";
import { ApprovalLevel } from "./approvalFlow/entity/approvalLevel.entity";
import { ApprovalLevelRepository } from "./approvalFlow/repository/approvalLevel.repository";
import { ApprovalLevelService } from "./approvalFlow/service/approvalLevel.service";
import { ApprovalLevelController } from "./approvalFlow/controller/approvalLevel.controller";
import { DeliveryChallanRepository } from "./deliveryChallans/deliverychllan/repository/deliveryChallan.repository";
import { DeliveryChallanPurchase } from "./deliveryChallans/deliverychllan/entity/deliveryChallan.entity";
import { DeliveryChallanService } from "./deliveryChallans/deliverychllan/service/deliveryChallan.service";
import { DeliveryChallanController } from "./deliveryChallans/deliverychllan/controller/deliveryChallan.controller";
import { DitemRepository } from "./deliveryChallans/deliverychllan/repository/dItem.repository";
import { Item } from "./deliveryChallans/deliverychllan/entity/dItem.entity";
import { CustomerDeliveryChallanRepository } from "./deliveryChallans/customerDeliveryChllan/repository/customerDeliveryChallan.repository";
import { CustomerDeliveryChallan } from "./deliveryChallans/customerDeliveryChllan/entity/customerDeliveryChallan.entity";
import { CustomerDeliveryChallanController } from "./deliveryChallans/customerDeliveryChllan/controller/customerDeliveryChallan.controller";
import { CustomerDeliveryChallanService } from "./deliveryChallans/customerDeliveryChllan/service/customerDeliveryChallan.service";
import { StockTransferDeliveryChallanRepository } from "./deliveryChallans/stockTransferDC/repository/stockTransferDeliveryChallan.repository";
import { StockTransferDeliveryChallan } from "./deliveryChallans/stockTransferDC/entity/stockTransferdeliveryChallan.entity";
import { StockTransferDeliveryChallanService } from "./deliveryChallans/stockTransferDC/service/stockTransferDeliveryChallan.service";
import { StockTranferDeliveryChallanController } from "./deliveryChallans/stockTransferDC/controller/stockTransferDeliveryChallan.controllers";
import { OtherDeliveryChallanRepository } from "./deliveryChallans/otherDeliveryChallan/repository/otherDeliveryChallan.repository";
import { OtherDeliveryChallan } from "./deliveryChallans/otherDeliveryChallan/entity/otherDeliveryChallan.entity";
import { OtherDeliveryChallanService } from "./deliveryChallans/otherDeliveryChallan/service/otherDeliveryChallan.service";
import { OtherDeliveryChallanController } from "./deliveryChallans/otherDeliveryChallan/controller/otherDeliveryChallan.controller";
import { PaymentRequestRepository } from "./paymentReq/repository/paymentRequest.repository";
import { PaymentRequestService } from "./paymentReq/service/paymentRequest.service";
import { PaymentRequestController } from "./paymentReq/controller/paymentRequest.controller";
import { PaymentRequest as PaymentRequestEntity } from "./paymentReq/entity/paymentRequest.entity";
import { AuditLogRepository } from "./employeeActivity/repository/AuditLog.repository";
import { AuditLog } from "./employeeActivity/entity/auditLog.entity";
import { AuditLogService } from "./employeeActivity/service/auditLog.service";
import { AuditLogController } from "./employeeActivity/controller/auditLog.controller";
import { UserSystemInfoRepository } from "./employeeSystemInfo/repository/userSystemInfo.repository";
import { SystemLog } from "./employeeSystemInfo/entity/userSystemInfo.entity";
import { RequestsService } from "./sse/request.service";
import { RequestsRepository } from "./sse/requests.repository";
import { Requests } from "./sse/request.entity";
import { LevelsRepository } from "./levels/repository/levels.repository";
import { Levels } from "./levels/entity/levels.entity";
import { LevelsService } from "./levels/service/levels.service";
import { LevelsController } from "./levels/controller/levels.controller";
import { InwardRepository } from "./inwardRegister/repository/inwardRegister.repository";
import { InwardRegister } from "./inwardRegister/entity/inwardRegister.entity";
import { InwardRegisterService } from "./inwardRegister/service/inwardRegister.service";
import { InwardRegisterController } from "./inwardRegister/controller/inwardRegister.controller";
import { DepartmentforApproveRepository } from "./approvalFlow/repository/departmentforapprove.repository";
import { Departments } from "./approvalFlow/entity/deparmentforapproval.entity";
import { LaborRegisterRepository } from "./labour/repository/labourRegister.repository";
import { LaborRegister } from "./labour/entity/labourregister.entity";
import { LaborRegisterService } from "./labour/service/labourRegister.service";
import { LaborRegisterController } from "./labour/controller/labourRegister.controller";
import { LaborAttendancesRepository } from "./labourAttendence/repository/labourAttendances.repository";
import { LaborAttendance } from "./labourAttendence/entity/laborattendance.entity";
import { LaborAttendancesService } from "./labourAttendence/service/labourAttendence.service";
import { LaborAttendancesController } from "./labourAttendence/controller/labourAttendances.controller";
import { LaborRepository } from "./labour/repository/labor.repository";
import { Labor } from "./labour/entity/labor.entity";
import { LaborService } from "./labour/service/labor.service";
import { LaborController } from "./labour/controller/labor.controller";
import { DumpRegisterRepository } from "./dumpRegister/repository/dumpRegister.repository";
import { DumpRegister } from "./dumpRegister/entity/dumpRegister.entity";
import { DumpRegisterService } from "./dumpRegister/service/dumpRegister.service";
import { DumpProductRepository } from "./dumpRegister/repository/dumpProduct.repository";
import { DumpRegisterController } from "./dumpRegister/controller/dumpRegister.controller";
import { DumpProduct } from "./dumpRegister/entity/dumpProduct.entity";
import { SkuEodRepository } from "./eodStock/repository/skuEod.repository";
import { SkuEodReport } from "./eodStock/entity/skuStock.entity";
import { SKUEodStockService } from "./eodStock/service/skuEodStock.service";
import { EodRepository } from "./eodStock/repository/eodstockreport.repository";
import { StockReportEod } from "./eodStock/entity/eodReportforinvendtory.entity";
import { EodStockService } from "./eodStock/service/eodStock.service";
import { EodStockController } from "./eodStock/controller/eodStock.controller";
import { VehicleDispatchRepository } from "./vehicleDispatch/repository/vehicleDispatch.repository";
import { VehicleDispatch } from "./vehicleDispatch/entity/vehicleDispatch.entity";
import { VehicleDispatchService } from "./vehicleDispatch/service/vehicleDispatch.service";
import { VehicleDispatchController } from "./vehicleDispatch/controller/vehicleDispatch.controller";
import { AqrRepository } from "./aqr/repository/aqr.repository";
import { Aqr } from "./aqr/entity/aqr.entity";
import { AqrService } from "./aqr/service/aqr.service";
import { AqrController } from "./aqr/controller/aqr.controller";
import { QualityParameterRepository } from "./product/createproduct/repository/qualityParameter.repository";
import { QualityParameter } from "./product/createproduct/entity/quantityParameter.entity";
import { SecondSaleRepository } from "./secondSale/repository/secondSale.repository";
import { SecondSale } from "./secondSale/entity/secondSale.entity";
import { SecondSaleService } from "./secondSale/service/secondSale.service";
import { SecondSaleController } from "./secondSale/controller/secondSale.controller";
import { SecondSaleProductRepository } from "./secondSale/repository/secondSaleProduct.repository";
import { SecondSaleProduct } from "./secondSale/entity/secondSaleProduct.entity";
import { SaleOrderRepository } from "./saleOrder/repository/saleOrder.repository";
import { SaleOrder } from "./saleOrder/entity/saleOrder.entity";
import { SaleOrderService } from "./saleOrder/service/saleOrder.service";
import { SaleOrderController } from "./saleOrder/controller/saleOrder.controller";
import { InvoiceRepository } from "./invoice/repository/invoice.repository";
import { Invoice } from "./invoice/entity/invoice.entity";
import { InvoiceProductRepository } from "./invoice/repository/invoiceProduct.repository";
import { InvoiceProduct } from "./invoice/entity/invoiceProduct.entity";
import { PostReturnByCustomerRepository } from "./returnByCustomer/repository/postReturnByCustomer.repository";
import { PostReturnByCustomer } from "./returnByCustomer/entity/postReturnByCustomer.entity";
import { PostReturnByCustomerService } from "./returnByCustomer/service/postReturnByCustomer.service";
import { PostReturnByCustomerController } from "./returnByCustomer/controller/postReturnByCustomer.controller";
import { ReturnedProductsRepository } from "./returnByCustomer/repository/returnProduct.repository";
import { ReturnedProducts } from "./returnByCustomer/entity/returnProduct.entity";
import { PdfGeneratorService } from "./utils/pdfGenerator";
import { CompanyRepository } from "./company/repository/company.repository";
import { Company } from "./company/entity/company.entity";
import { CompanyService } from "./company/service/company.service";
import { CompanyController } from "./company/controller/company.controller";
import { ProcurmentDashService } from "./dashboard/service/procurmentDashbord.service";
import { ProcurmentDashController } from "./dashboard/controller/procurmentDashboard.controller";
import { ManagementDashService } from "./dashboard/service/managementDashboard.service";
import { ManagementDashController } from "./dashboard/controller/managementDashboard.controller";
import { InventoryStockRepository } from "./inventoryStock/repository/inventoryStock.repository";
import { InventoryStock } from "./inventoryStock/entity/inventoryStock.entity";
import { InventoryStockController } from "./inventoryStock/controller/inventoryStock.controller";
import { InventoryStockService } from "./inventoryStock/service/inventoryStock.service";
import { InventoryMovementService } from "./inventoryStock/service/inventoryMovement.service";
import { ProductVarientsRepository } from "./product/productVarient/repository/productVarients.repository";
import { ProductVarient } from "./product/productVarient/entity/productVarient.entity";
import { ProductVarientService } from "./product/productVarient/service/productVarient.service";
import { ProductVarientController } from "./product/productVarient/controller/productVarient.controller";
import { PackingMaterialRepository } from "./packingMaterial/repository/packingMaterial.repository";
import { PackingMaterial } from "./packingMaterial/entity/packingMaterial.entity";
import { PackingMaterialService } from "./packingMaterial/service/packingMaterial.service";
import { PackingMaterialController } from "./packingMaterial/controller/packingMaterial.controller";
import { DocumentDefinitionRepository } from "./documentDef/repository/documentDefination.repository";
import { DocumentDefinition } from "./documentDef/entity/documentdef.entity";
import { DocumentDefinitionService } from "./documentDef/service/documentDefinition.service";
import { DocumentDefinitionController } from "./documentDef/controller/documentDefination.controller";
import { DocumentPermissionService } from "./employee/service/documentPermission.service";
import { DocumentPermission } from "./employee/entity/permission.entity";
import { DocumentPermissionController } from "./employee/controller/documentPermission.controller";
import { DocumentPermissionRepository } from "./employee/repository/documentPermission.repository";
import { DocumentbRepository } from "./approvalFlow/repository/documentb.repository";
import { Documentb } from "./approvalFlow/entity/docuemnt.entity";
import { DocumentbService } from "./approvalFlow/service/documentb.service";
import { DocumentbController } from "./approvalFlow/controller/documentb.controller";
import { ApprovalFlowRepository } from "./approvalFlow/repository/approvalFlow.repository";
import { ApprovalFlow } from "./approvalFlow/entity/approvalFlow.entity";
import { ApprovalFlowService } from "./approvalFlow/service/approvalFlow.service";
import { ApprovalFlowController } from "./approvalFlow/controller/approvalFlow.controller";
import { FinalizerBlockRepository } from "./approvalFlow/repository/finalizerBlock.repository";
import { ApproverBlock } from "./approvalFlow/entity/approvalBlock.entity";
import { FinalizerBlock } from "./approvalFlow/entity/finalizerBlock.entity";
import { ApproverBlockRepository } from "./approvalFlow/repository/approverBlock.repository";
import { ApprovalStageInfoRepository } from "./approvalFlow/repository/approvalStageInfoRepository";
import { ApprovalStageInfo } from "./approvalFlow/entity/approvalname.entity";
import { DocumentApprovalFlowRepository } from "./approvalFlow/repository/DocumentApprovalFlowRepository.repository";
import { DocumentApprovalFlow } from "./approvalFlow/entity/documentApproveBy.entity";
import { InwardProductRepository } from "./inwardRegister/repository/inwardProduct.repository";
import { InwardProduct } from "./inwardRegister/entity/inwardProduct.entity";
import { DocDoubleApproverService } from "./approvalFlow/service/docDoubleApprover.service";
import { DocSingalApproverService } from "./approvalFlow/service/DocSingalApproverService.service";
import { AdminDashboardService } from "./dashboard/service/adminDashboardService.service";
import { WeeklyBusinessPlanService } from "./dashboard/service/weeklyBusinessPlan.service";
import { AdminDashboardController } from "./dashboard/controller/adminDashboard.controller";
import { ProductVarientRepository } from "./product/productVarient/repository/varients.repository";
import { ProductVarientsService } from "./product/productVarient/service/varients.service";
import { VarientsController } from "./product/productVarient/controller/varient.controller";
import { ExcelController } from "./getExcel/getexcel.controller";
import { ActiveSessionRepository } from "./auth/repository/activeSession.repository";
import { ActiveSession } from "./auth/entity/activeSession.entity";
import { UserReportService } from "./employeeReport/service/userreport.service";
import { UserReportController } from "./employeeReport/controller/userReport.controller";
import { SuperAdminController } from "./sse/superAdmin.controller";
import { SuperAdminService } from "./sse/superadmin.service";
import { CacheService } from "./global/cache.service";
import { DocumentExportService } from "./excel/export/documentExport.service";
import { VouchersController } from "./vouchers/controller/vouchers.controller";
import { QueryOptimizerService } from "./global/queryOptimizer.service";
import { CrystalReportService } from "./reports/service/crystalReport.service";
import { ProcurementCrystalReportService } from "./reports/service/procurementCrystalReport.service";
import { ProcurementCrystalReportController } from "./reports/controller/procurementCrystalReport.controller";
import { SalesCrystalReportService } from "./reports/service/salesCrystalReport.service";
import { SalesCrystalReportController } from "./reports/controller/salesCrystalReport.controller";
import { SSEService } from "./sse/sse.service";
import { SSEController } from "./sse/sse.controller";
import { SSEHelperService } from "./utils/SSE_HELPER_SERVICE";
import { TestController } from "./sse/test.controller";
import { UserActivityLogRepository } from "./employeeActivity/repository/userActivityLog.repository";
import { UserActivityLog } from "./employeeActivity/entity/userActivityLog.entity";
import { UserActivityLogService } from "./employeeActivity/service/userActivityLog.service";
import { UserActivityLogController } from "./employeeActivity/controller/userActivityLog.controller";
import { WorkflowHierarchyRepository } from "./workFlow/repository/WorkflowHierarchy.repository";
import { WorkflowHierarchy } from "./workFlow/entity/workflowClosure.entity";
import { WorkflowHierarchyService } from "./workFlow/service/workFlowHierarchy.service";
import { WorkflowHierarchyController } from "./workFlow/controller/WorkflowHierarchy.controller";
import { ProcurementTargetRepository } from "./procurementTarget/repository/procurementTarget.repository";
import { ProcurementTarget } from "./procurementTarget/entity/procurmentTarget.entity";
import { ProcurementTargetService } from "./procurementTarget/service/procurementTarget.service";
import { ProcurementTargetController } from "./procurementTarget/controller/procurementTarget.controller";
import { ProcurementTargetProductRepository } from "./procurementTarget/repository/procurmentTargetProduct.repository";
import { ProcurementTargetProduct } from "./procurementTarget/entity/procurementTargetProduct.entity";
import { ProcurementTargetWeekRepository } from "./procurementTarget/repository/procurmentTargetWeek.repository";
import { ProcurementTargetWeek } from "./procurementTarget/entity/procurementTargetWeek.entity";
import { ProcurementTargetAchievementRepository } from "./procurementTarget/repository/procurmentAchievement.repository";
import { ProcurementAchievement } from "./procurementTarget/entity/procurementAchievement.entity";
import { SalesTargetRepository } from "./salesTarget/repository/salesTarget.repository";
import { SalesTarget } from "./salesTarget/entity/salesTarget.entity";
import { SalesTargetService } from "./salesTarget/service/salesTarget.service";
import { SalesTargetController } from "./salesTarget/controller/salesTarget.controller";
import { SalesTargetProductRepository } from "./salesTarget/repository/salesTargetProduct.repository";
import { SalesTargetProduct } from "./salesTarget/entity/salesTargetProduct.entity";
import { SalesTargetWeekRepository } from "./salesTarget/repository/salesTargetWeek.repository";
import { SalesTargetWeek } from "./salesTarget/entity/salesTargetWeek.entity";
import { SalesAchievementRepository } from "./salesTarget/repository/salesAchievement.repository";
import { SalesAchievement } from "./salesTarget/entity/salesachivement.entity";
import { DashboardService } from "./dashboard/service/dashboard.service";
import { DashboardController } from "./dashboard/controller/dashboard.controller";
import { NewRegistrationService } from "./reports/service/newRegistration.service";
import { NewRegistrationController } from "./reports/controller/newRegistration.controller";
import { ReportService } from "./reports/service/report.service";
import { SalesReportService } from "./reports/service/salesReport.service";
import { ReportController } from "./reports/controller/report.controller";
import { ReturnToVendorService } from "./returnToVendor/service/retrunToVendor.service";
import { PaymentInfoForRFPA } from "./rfpa/entity/rfpaPayementInfo.entity";
import { ReturnToVendorRepository } from "./returnToVendor/repository/returnToVendor.repository";
import { RfpaPaymentInfoRepository } from "./rfpa/repository/rfpaPaymentInfo.repository";
import { ReturnToVendor } from "./returnToVendor/entity/returnToVendor.entity";
import { ReturnToVendorController } from "./returnToVendor/controller/returnToVendor.controller";
import { FinalInvoiceService } from "./invoice/service/finalInvoice.service";
import { FinalInvoiceController } from "./invoice/controller/finalInvoice.controller";
import { FinalInvoiceReportService } from "./reports/service/finalInvoiceReport.service";
import { FinalInvoiceReportController } from "./reports/controller/finalInvoiceReport.controller";
import { StockCorrectionRepository } from "./stockCorrection/repository/stockCorrection.repository";
import { StockCorrectionService } from "./stockCorrection/service/stockCorrection.service";
import { StockCorrection } from "./stockCorrection/entity/stockCorrection.entity";
import { StockCorrectionController } from "./stockCorrection/controller/stockCorrection.controller";
import { GrnProductHistoryRepository } from "./grn/repository/grnProductHistory.repository";
import { GrnProductHistoryService } from "./grn/service/grnProductHistory.service";
import { GrnProductHistory } from "./grn/entity/grnProductHistory.entity";

const container = new Container();
//socket server
// Initialize Socket.IO server
//const io = new Server();
// Bind to the container
//container.bind<Server>(TYPES.SocketIoServer).toConstantValue(io);
// Define a helper function for repository binding
// // Initialize Socket.IO server
// const io = new SocketIOServer();
// // Bind to the container
// container.bind<SocketIOServer>(TYPES.SocketIoServerOne).toConstantValue(io);

container.bind<DataSource>(TYPES.DataSource).toConstantValue(AppDataSource);
container.bind<FileController>(TYPES.FileController).to(FileController).inSingletonScope();

// ----- User-related bindings -----


container
  .bind<UserController>(TYPES.UserController)
  .to(UserController)
  .inSingletonScope();
container
  .bind<UserService>(TYPES.UserService)
  .to(UserService)
  .inSingletonScope();

    // Assuming TYPES.BillingDetailsCustRepository is a symbol or string used to identify the repository
container.bind<UserRepository>(TYPES.UserRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(User).extend(UserRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements

container
  .bind<AuthController>(TYPES.AuthController)
  .to(AuthController)
  .inSingletonScope();
 
//-------------------------------------------vendor-Category-----------------------------//
// Bind your services and repositories
// Bind DataSource (make sure to initialize it somewhere in your code)
//container.bind<DataSource>(TYPES.DataSource).toConstantValue(AppDataSource);
//address
// container
//   .bind<AddressRepository>(TYPES.AddressRepository)
//   .to(AddressRepository)
//   .inSingletonScope();
// Assuming TYPES.BankDetailsCustRepository is a symbol or string used to identify the repository
container.bind<AddressRepository>(TYPES.AddressRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Address).extend(AddressRepository);
}).inRequestScope()
  container
  .bind<AddressController>(TYPES.AddressController)
  .to(AddressController)
  .inSingletonScope();
  container
  .bind<AddressService>(TYPES.AddressService)
  .to(AddressService)
  .inSingletonScope();

  //vendor category
 // Assuming TYPES.BillingDetailsCustRepository is a symbol or string used to identify the repository
 container.bind<VendorCategoryRepository>(TYPES.VendorCategoryRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(VendorCategory).extend(VendorCategoryRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements

container
  .bind<VendorCategoryController>(TYPES.VendorCategoryController)
  .to(VendorCategoryController)
  .inSingletonScope();
  container
  .bind<VendorCategoryService>(TYPES.VendorCategoryService)
  .to(VendorCategoryService)
  .inSingletonScope();

//---------------vendorSubcategory-------------------------------
container
  .bind<VendorSubcategoryService>(TYPES.VendorSubcategoryService)
  .to(VendorSubcategoryService)
  .inSingletonScope();
   // Assuming TYPES.BillingDetailsCustRepository is a symbol or string used to identify the repository
container.bind<VendorSubcategoryRepository>(TYPES.VendorSubcategoryRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(VendorSubcategory).extend(VendorSubcategoryRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements

container
  .bind<VendorSubcategoryController>(TYPES.VendorSubcategoryController)
  .to(VendorSubcategoryController)
  .inSingletonScope();

//------------------Vendor------------------------------------------
container
  .bind<VendorService>(TYPES.VendorService)
  .to(VendorService)
  .inSingletonScope();
// container
//   .bind<VendorRepository>(TYPES.VendorRepository)
//   .to(VendorRepository)
//   .inSingletonScope();
  // Assuming TYPES.BillingDetailsCustRepository is a symbol or string used to identify the repository
container.bind<VendorRepository>(TYPES.VendorRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Vendor).extend(VendorRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container
  .bind<VendorController>(TYPES.VendorController)
  .to(VendorController)
  .inSingletonScope();

//---------------------------Customer------------------------
container
  .bind<CustomerService>(TYPES.CustomerService)
  .to(CustomerService)
  .inSingletonScope();
// container
//   .bind<CustomerRepository>(TYPES.CustomerRepository)
//   .to(CustomerRepository)
//   .inSingletonScope();

  container.bind<CustomerRepository>(TYPES.CustomerRepository).toDynamicValue((context) => {
    const dataSource = context.container.get<DataSource>(TYPES.DataSource);
    return dataSource.getRepository(Customer).extend(CustomerRepository);
  }).inRequestScope();
container
  .bind<CustomerController>(TYPES.CustomerController)
  .to(CustomerController)
  .inSingletonScope();

//---------------------------CustomerType------------------------
container
  .bind<CustomerTypeService>(TYPES.CustomerTypeService)
  .to(CustomerTypeService)
  .inSingletonScope();
container
  .bind<CustomerTypeRepository>(TYPES.CustomerTypeRepository)
  .to(CustomerTypeRepository)
  .inSingletonScope();
container
  .bind<CustomerTypeController>(TYPES.CustomerTypeController)
  .to(CustomerTypeController)
  .inSingletonScope();

//-----------------CustomerCategory-----------------

container
  .bind<CustomerCategoryService>(TYPES.CustomerCategoryService)
  .to(CustomerCategoryService)
  .inSingletonScope();
container
  .bind<CustomerCategoryRepository>(TYPES.CustomerCategoryRepository)
  .to(CustomerCategoryRepository)
  .inSingletonScope();
container
  .bind<CustomerCategoryController>(TYPES.CustomerCategoryController)
  .to(CustomerCategoryController)
  .inSingletonScope();

//----------------------Farmer-----------------------------

container
  .bind<FarmerService>(TYPES.FarmerService)
  .to(FarmerService)
  .inSingletonScope();

  container.bind<FarmerRepository>(TYPES.FarmerRepository).toDynamicValue((context) => {
    const dataSource = context.container.get<DataSource>(TYPES.DataSource);
    return dataSource.getRepository(Farmer).extend(FarmerRepository);
  }).inRequestScope(); // or .singletonScope() depending on your scope requirements
container
  .bind<FarmerController>(TYPES.FarmerController)
  .to(FarmerController)
  .inSingletonScope();
//----------------------Crop-----------------------------




  container.bind<CropRepository>(TYPES.CropRepository).toDynamicValue((context) => {
    const dataSource = context.container.get<DataSource>(TYPES.DataSource);
    return dataSource.getRepository(Crop).extend(CropRepository);
  }).inRequestScope(); // or .singletonScope() depending on your scope requirements
  


//------------------------UOMconversionMatrix-----------------------------
container
  .bind<UOMConversionMatrixService>(TYPES.UOMConversionMatrixService)
  .to(UOMConversionMatrixService)
  .inSingletonScope();
container
  .bind<UOMConversionMatrixRepository>(TYPES.UOMConversionMatrixRepository)
  .to(UOMConversionMatrixRepository)
  .inSingletonScope();
container
  .bind<UOMConversionMatrixController>(TYPES.UOMConversionMatrixController)
  .to(UOMConversionMatrixController)
  .inSingletonScope();

//------------------------UOM-----------------------------------

container.bind<UOMRepository>(TYPES.UOMRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(UOM).extend(UOMRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<UOMService>(TYPES.UOMService).to(UOMService);
container.bind<UOMController>(TYPES.UOMController).to(UOMController);

//----------------------Product_Category-------------------------
container
  .bind<ProductCategoryService>(TYPES.ProductCategoryService)
  .to(ProductCategoryService)
  .inSingletonScope();

  container.bind<ProductCategoryRepository>(TYPES.ProductCategoryRepository).toDynamicValue((context) => {
    const dataSource = context.container.get<DataSource>(TYPES.DataSource);
    return dataSource.getRepository(ProductCategory).extend(ProductCategoryRepository);
  }).inRequestScope(); // or .singletonScope() depending on your scope requirements
container
  .bind<ProductCategoryController>(TYPES.ProductCategoryController)
  .to(ProductCategoryController)
  .inSingletonScope();

//----------------------------Product_Subcategory------------
container
  .bind<ProductSubcategoryService>(TYPES.ProductSubcategoryService)
  .to(ProductSubcategoryService)
  .inSingletonScope();
container
  .bind<ProductSubcategoryRepository>(TYPES.ProductSubcategoryRepository)
  .to(ProductSubcategoryRepository)
  .inSingletonScope();
container
  .bind<ProductSubcategoryController>(TYPES.ProductSubcategoryController)
  .to(ProductSubcategoryController);

//----------------------------Product---------------------------------------

container.bind<ProductService>(TYPES.ProductService).to(ProductService);



  container.bind<ProductRepository>(TYPES.ProductRepository).toDynamicValue((context) => {
    const dataSource = context.container.get<DataSource>(TYPES.DataSource);
    return dataSource.getRepository(Product).extend(ProductRepository);
  }).inRequestScope(); // or .singletonScope() depending on your scope requirements

container
  .bind<ProductController>(TYPES.ProductController)
  .to(ProductController);


 

//-------------------------driver------------------------------
container.bind<DriversService>(TYPES.DriversService).to(DriversService);
container.bind<DriverRepository>(TYPES.DriverRepository).to(DriverRepository).inSingletonScope();
container.bind<DriverController>(TYPES.DriverController).to(DriverController).inSingletonScope();
//-------------------------------productclassfication------------------------------
container.bind<ProductClassificationService>(TYPES.ProductClassificationService).to(ProductClassificationService);
container.bind<ProductClassificationController>(TYPES.ProductClassificationController).to(ProductClassificationController);

container.bind<ProductClassificationRepository>(TYPES.ProductClassificationRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ProductClassification).extend(ProductClassificationRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements


//--------------------------bank-detailscust-----------
// container.bind(TYPES.BankDetailsCustRepository).toDynamicValue((context) => {
//   const dataSource = context.container.get<DataSource>(TYPES.DataSource);
//   return dataSource.getRepository(BankDetailsCustRepository);
// });
// Assuming TYPES.BankDetailsCustRepository is a symbol or string used to identify the repository
container.bind<BankDetailsCustRepository>(TYPES.BankDetailsCustRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(BankDetailsCust).extend(BankDetailsCustRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
//container.bind<BankDetailsCustRepository>(TYPES.BankDetailsCustRepository).to(BankDetailsCustRepository);


//-----------------------------------billingDetailsCust----------------------------
// Assuming TYPES.BillingDetailsCustRepository is a symbol or string used to identify the repository
container.bind<BillingDetailsCustRepository>(TYPES.BillingDetailsCustRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(BillingDetailsCust).extend(BillingDetailsCustRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements



// Assuming TYPES.BillingDetailsCustRepository is a symbol or string used to identify the repository
container.bind<BranchessRepository>(TYPES.BranchessRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Branches).extend(BranchessRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements

container.bind<BranchessService>(TYPES.BranchessService).to(BranchessService);
container.bind<BranchessController>(TYPES.BranchessController).to(BranchessController);

// Assuming TYPES.BillingDetailsCustRepository is a symbol or string used to identify the repository
container.bind<OfficesRepository>(TYPES.OfficesRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(OfficesData).extend(OfficesRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements

container.bind<OfficesService>(TYPES.OfficesService).to(OfficesService);
container.bind<OfficesController>(TYPES.OfficesController).to(OfficesController);
//----------------------------deliveryDetailsCust---------------
container.bind<DeliveryDetailsCustRepository>(TYPES.DeliveryDetailsCustRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(DeliveryDetails).extend(DeliveryDetailsCustRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements



//----------------------------statutorydetailsCust---------------
container.bind<StatutoryDetailsCustRepository>(TYPES.StatutoryDetailsCustRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(StatutoryDetails).extend(StatutoryDetailsCustRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements



//---------------------------payment_terms_customer---------------------------------
// Assuming TYPES.paymentTermsRepository is a symbol or string used to identify the repository
container.bind<PaymentTermsRepository>(TYPES.PaymentTermsRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(PaymentTerms).extend(PaymentTermsRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<PaymentTermsService>(TYPES.PaymentTermsService).to(PaymentTermsService)
//----------------------------productSpecificationCust---------------
container.bind<ProductSpecificationCustRepository>(TYPES.ProductSpecificationCustRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ProductSpecification).extend(ProductSpecificationCustRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements


//--------------------------------keyMobileNumber-----------------------------------------
container.bind<KeyMobileNoDataRepository>(TYPES.KeyMobileNoDataRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(keyMobileNoData).extend(KeyMobileNoDataRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements

container.bind<KeyMobileNoDataService>(TYPES.KeyMobileNoDataService).to(KeyMobileNoDataService);
//---------------------------bankdetailsvend---------------------------------
// Assuming TYPES.BankDetailsvendRepository is a symbol or string used to identify the repository
container.bind<BankDetailsvendRepository>(TYPES.BankDetailsvendRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(BankDetailsvend).extend(BankDetailsvendRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<BankDetailsvendService>(TYPES.BankDetailsvendService).to(BankDetailsvendService)
//-------------------------------------vendor_sale_info----------------------
// Assuming TYPES.VendorSaleInfoRepository is a symbol or string used to identify the repository
container.bind<VendorSaleInfoRepository>(TYPES.VendorSaleInfoRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(VendorSaleInfo).extend(VendorSaleInfoRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<VendorSaleInfoService>(TYPES.VendorSaleInfoService).to(VendorSaleInfoService)

//-------------------------------------rfpa----------------------
// Assuming TYPES.VendorSaleInfoRepository is a symbol or string used to identify the repository
container.bind<RfpaRepository>(TYPES.RfpaRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(RFPA).extend(RfpaRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<RfpaService>(TYPES.RfpaService).to(RfpaService);
container.bind< RfpaController>(TYPES.RfpaController).to( RfpaController);

//-------------------------------------deal-slip----------------------
// Assuming TYPES.VendorSaleInfoRepository is a symbol or string used to identify the repository
container.bind<DealSlipRepository>(TYPES.DealSlipRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(DealSlip).extend(DealSlipRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<DealSlipService>(TYPES.DealSlipService).to(DealSlipService);
container.bind<DealSlipController>(TYPES.DealSlipController).to( DealSlipController);

//----------------------------------Grn---------------------------------
container.bind<GrnRepository>(TYPES.GrnRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(GRN).extend(GrnRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<GrnService>(TYPES.GrnService).to(GrnService);
container.bind<GrnController>(TYPES.GrnController).to(GrnController);
container.bind<GrnReportService>(TYPES.GrnReportService).to(GrnReportService);
container.bind<GrnReportController>(TYPES.GrnReportController).to(GrnReportController);

//----------------------------------Delivery Challan Report---------------------------------
container.bind<DeliveryChallanReportService>(TYPES.DeliveryChallanReportService).to(DeliveryChallanReportService);
container.bind<DeliveryChallanReportController>(TYPES.DeliveryChallanReportController).to(DeliveryChallanReportController);
//------------------------------GrnProduct---------------------------
container.bind<GrnProductRepository>(TYPES.GrnProductRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(GrnProduct).extend(GrnProductRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<GrnProductService>(TYPES.GrnProductService).to(GrnProductService);


//-----------------------------nofication-----------------------------------------
container.bind<NotificationRepository>(TYPES.NotificationRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(NotificationEntity).extend(NotificationRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<NotificationService>(TYPES.NotificationService).to(NotificationService);
container.bind<NotificationController>(TYPES.NotificationController).to(NotificationController);

//-------------------------------transport_Payment_Voucher-------------------------------
container.bind<TPVoucherRepository>(TYPES.TPVoucherRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(TPVoucher).extend(TPVoucherRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<TPVoucherService>(TYPES.TPVoucherService).to(TPVoucherService).inSingletonScope();
container.bind<TPVoucherController>(TYPES.TPVoucherController).to(TPVoucherController).inSingletonScope();


//-------------------------------packing_material_Payment_Voucher-------------------------------
container.bind<PMPVoucherRepository>(TYPES.PMPVoucherRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(PMPVoucher).extend(PMPVoucherRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<PMPVoucherService>(TYPES.PMPVoucherService).to(PMPVoucherService).inSingletonScope();
container.bind<PMPVoucherController>(TYPES.PMPVoucherController).to(PMPVoucherController).inSingletonScope();

//-------------------------------multiCash_Payment_Voucher-------------------------------
container.bind<MultiCashVoucherRepository>(TYPES.MultiCashVoucherRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(CashVoucher).extend(MultiCashVoucherRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<MultiCashVoucherService>(TYPES.MultiCashVoucherService).to(MultiCashVoucherService);
container.bind<MultiCashVoucherController>(TYPES.MultiCashVoucherController).to(MultiCashVoucherController);


//--------------------------------------labour payment voucher--------------------
container.bind<LabourPaymentVoucherRepository>(TYPES.LabourPaymentVoucherRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(LPVoucher).extend(LabourPaymentVoucherRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<LabourPaymentVoucherService>(TYPES.LabourPaymentVoucherService).to(LabourPaymentVoucherService);
container.bind<LabourPaymentVoucherController>(TYPES.LabourPaymentVoucherController).to(LabourPaymentVoucherController);


//--------------------------------------Approval level --------------------
container.bind<ApprovalLevelRepository>(TYPES.ApprovalLevelRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ApprovalLevel).extend(ApprovalLevelRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<ApprovalLevelService>(TYPES.ApprovalLevelService).to(ApprovalLevelService);
container.bind<ApprovalLevelController>(TYPES.ApprovalLevelController).to(ApprovalLevelController);

//--------------------------------------delivery challan --------------------
container.bind<DeliveryChallanRepository>(TYPES.DeliveryChallanRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository( DeliveryChallanPurchase).extend(DeliveryChallanRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<DeliveryChallanService>(TYPES.DeliveryChallanService).to(DeliveryChallanService);
container.bind<DeliveryChallanController>(TYPES.DeliveryChallanController).to(DeliveryChallanController);
container.bind<DitemRepository>(TYPES.DitemRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository( Item).extend(DitemRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements

//------------------customer delivery challan-------------------------
container.bind<CustomerDeliveryChallanRepository>(TYPES.CustomerDeliveryChallanRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(CustomerDeliveryChallan).extend(CustomerDeliveryChallanRepository);
}).inRequestScope(); 
container.bind<CustomerDeliveryChallanService>(TYPES.CustomerDeliveryChallanService).to(CustomerDeliveryChallanService);
container.bind<CustomerDeliveryChallanController>(TYPES.CustomerDeliveryChallanController).to( CustomerDeliveryChallanController);
//-----------------------tranfer delivery challan-----------------------
container.bind< StockTransferDeliveryChallanRepository>(TYPES. StockTransferDeliveryChallanRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(StockTransferDeliveryChallan).extend( StockTransferDeliveryChallanRepository);
}).inRequestScope(); 
container.bind<StockTransferDeliveryChallanService>(TYPES.StockTransferDeliveryChallanService).to(StockTransferDeliveryChallanService);
container.bind<StockTranferDeliveryChallanController>(TYPES.StockTranferDeliveryChallanController).to(StockTranferDeliveryChallanController);
//----------------------------other  delivery challan-------
container.bind< OtherDeliveryChallanRepository>(TYPES.OtherDeliveryChallanRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(OtherDeliveryChallan).extend(OtherDeliveryChallanRepository);
}).inRequestScope(); 
container.bind<OtherDeliveryChallanService>(TYPES.OtherDeliveryChallanService).to(OtherDeliveryChallanService);
container.bind<OtherDeliveryChallanController>(TYPES.OtherDeliveryChallanController).to(OtherDeliveryChallanController);
//--------------------------------------payment request----------------------------------------
container.bind<PaymentRequestRepository>(TYPES.PaymentRequestRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(PaymentRequestEntity).extend(PaymentRequestRepository);
}).inRequestScope(); 
container.bind<PaymentRequestService>(TYPES.PaymentRequestService).to(PaymentRequestService).inSingletonScope();
container.bind<PaymentRequestController>(TYPES.PaymentRequestController ).to(PaymentRequestController ).inSingletonScope();
//-----------------------------auditlog---------------------------------------
container.bind<AuditLogRepository>(TYPES.AuditLogRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(AuditLog).extend(AuditLogRepository);
}).inRequestScope(); 
container.bind< AuditLogService>(TYPES. AuditLogService).to(AuditLogService).inSingletonScope();
container.bind< AuditLogController>(TYPES.AuditLogController ).to(AuditLogController).inSingletonScope();

//-----------------------------userSystemInfo---------------------------------------
container.bind<UserSystemInfoRepository>(TYPES.UserSystemInfoRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository( SystemLog).extend(UserSystemInfoRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
//container.bind<UserSystemInfoService>(TYPES.UserSystemInfoService).to(UserSystemInfoService);

//-----------------------------RequestForApprove---------------------------------------
container.bind<RequestsRepository>(TYPES.RequestsRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Requests).extend(RequestsRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<RequestsService>(TYPES.RequestsService).to(RequestsService).inSingletonScope();

//--------------------------------levels -----------------------------------------

container.bind<LevelsRepository>(TYPES.LevelsRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Levels).extend(LevelsRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<LevelsService>(TYPES.LevelsService).to(LevelsService).inSingletonScope();
container.bind<LevelsController>(TYPES.LevelsController ).to(LevelsController ).inSingletonScope();
//------------------------------InwardRegister--------------------------------
container.bind<InwardRepository>(TYPES.InwardRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(InwardRegister).extend(InwardRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<InwardRegisterService>(TYPES.InwardRegisterService).to(InwardRegisterService).inSingletonScope();
container.bind<InwardRegisterController>(TYPES.InwardRegisterController).to(InwardRegisterController).inSingletonScope();
//-----------------------------department for approve -------------------------------
container.bind<DepartmentforApproveRepository>(TYPES.DepartmentforApproveRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Departments).extend(DepartmentforApproveRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements


//------------------------------------labour-register-----------------------------------------
container.bind<LaborRegisterRepository>(TYPES.LaborRegisterRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(LaborRegister).extend(LaborRegisterRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<LaborRegisterService>(TYPES.LaborRegisterService).to(LaborRegisterService).inSingletonScope();
container.bind<LaborRegisterController>(TYPES.LaborRegisterController).to(LaborRegisterController).inSingletonScope();


//------------------------------------labour-Attendances-----------------------------------------
container.bind<LaborAttendancesRepository>(TYPES.LaborAttendancesRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(LaborAttendance).extend(LaborAttendancesRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<LaborAttendancesService>(TYPES.LaborAttendancesService).to(LaborAttendancesService).inSingletonScope();
container.bind<LaborAttendancesController>(TYPES.LaborAttendancesController).to(LaborAttendancesController).inSingletonScope();

///-------------------------------------------------labor main----------------
container.bind<LaborRepository>(TYPES. LaborRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Labor).extend(LaborRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<LaborService>(TYPES.LaborService).to(LaborService).inSingletonScope();
container.bind< LaborController>(TYPES. LaborController).to( LaborController).inSingletonScope();


//dump register
container.bind<DumpRegisterRepository>(TYPES.DumpRegisterRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(DumpRegister).extend(DumpRegisterRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<DumpRegisterService>(TYPES.DumpRegisterService).to(DumpRegisterService).inSingletonScope();
container.bind< DumpRegisterController>(TYPES.DumpRegisterController).to( DumpRegisterController).inSingletonScope();
//dump product
container.bind<DumpProductRepository>(TYPES.DumpProductRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(DumpProduct).extend(DumpProductRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
// //dump summary
// container.bind<DumpSummaryRepository>(TYPES.DumpSummaryRepository).toDynamicValue((context) => {
//   const dataSource = context.container.get<DataSource>(TYPES.DataSource);
//   return dataSource.getRepository(DumpSummary).extend(DumpSummaryRepository);
// }).inRequestScope(); // or .singletonScope() depending on your scope requirements

//SKU Eod Stock
container.bind<SkuEodRepository>(TYPES.SkuEodRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(SkuEodReport).extend( SkuEodRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<SKUEodStockService>(TYPES.SKUEodStockService).to(SKUEodStockService).inSingletonScope();
//container.bind<SkuEodStockController>(TYPES.SkuEodStockController).to(SkuEodStockController).inSingletonScope();


//Eod Stock
container.bind<EodRepository>(TYPES.EodRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(StockReportEod).extend(EodRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<EodStockService>(TYPES.EodStockService).to(EodStockService).inSingletonScope();
container.bind<EodStockController>(TYPES.EodStockController).to(EodStockController).inSingletonScope();
//reportingManager

//vehicle dispatch 
container.bind<VehicleDispatchRepository>(TYPES.VehicleDispatchRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(VehicleDispatch).extend(VehicleDispatchRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<VehicleDispatchService>(TYPES.VehicleDispatchService).to(VehicleDispatchService).inSingletonScope();
container.bind< VehicleDispatchController>(TYPES.VehicleDispatchController).to( VehicleDispatchController).inSingletonScope();

//Aqr
container.bind<AqrRepository>(TYPES. AqrRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Aqr).extend( AqrRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<AqrService>(TYPES.AqrService).to(AqrService).inSingletonScope();
container.bind<AqrController>(TYPES.AqrController).to( AqrController).inSingletonScope();

//quality parameter
container.bind<QualityParameterRepository>(TYPES.QualityParameterRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(QualityParameter).extend(QualityParameterRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements


//secondSale
container.bind<SecondSaleRepository>(TYPES.SecondSaleRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(SecondSale).extend(SecondSaleRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<SecondSaleService>(TYPES.SecondSaleService).to(SecondSaleService).inSingletonScope();
container.bind<SecondSaleController>(TYPES.SecondSaleController).to(SecondSaleController).inSingletonScope();
//secondsale product
container.bind<SecondSaleProductRepository >(TYPES.SecondSaleProductRepository ).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(SecondSaleProduct).extend(SecondSaleProductRepository );
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
//dailyInwardSummary







//sale order
container.bind<SaleOrderRepository>(TYPES.SaleOrderRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(SaleOrder).extend(SaleOrderRepository);
}).inRequestScope(); 
container.bind<SaleOrderService>(TYPES.SaleOrderService).to(SaleOrderService).inSingletonScope();
container.bind<SaleOrderController>(TYPES.SaleOrderController).to(SaleOrderController).inSingletonScope()

//invoice
container.bind<InvoiceRepository>(TYPES.InvoiceRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Invoice).extend(InvoiceRepository);
}).inRequestScope(); 
container.bind<InvoiceProductRepository>(TYPES.InvoiceProductRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(InvoiceProduct).extend(InvoiceProductRepository);
}).inRequestScope(); 


//returnByCustomer
container.bind<PostReturnByCustomerRepository>(TYPES.PostReturnByCustomerRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(PostReturnByCustomer).extend(PostReturnByCustomerRepository);
}).inRequestScope(); 
container.bind<PostReturnByCustomerService>(TYPES.PostReturnByCustomerService).to(PostReturnByCustomerService).inSingletonScope();
container.bind<PostReturnByCustomerController>(TYPES.ReturnByCustomerController).to(PostReturnByCustomerController).inSingletonScope();
//return product by customer
container.bind<ReturnedProductsRepository>(TYPES.ReturnedProductsRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ReturnedProducts).extend(ReturnedProductsRepository);
}).inRequestScope();
//pdfgebnerator
container.bind<PdfGeneratorService>(TYPES.PdfGeneratorService).to(PdfGeneratorService).inSingletonScope();
//company
container.bind<CompanyRepository>(TYPES.CompanyRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(Company).extend(CompanyRepository);
}).inRequestScope(); // or .singletonScope() depending on your scope requirements
container.bind<CompanyService>(TYPES.CompanyService).to(CompanyService).inSingletonScope();
container.bind<CompanyController>(TYPES.CompanyController).to(CompanyController).inSingletonScope();
//procurmentDashboard
container.bind<ProcurmentDashService>(TYPES.ProcurmentDashService).to(ProcurmentDashService).inSingletonScope();
container.bind< ProcurmentDashController >(TYPES. ProcurmentDashController ).to( ProcurmentDashController ).inSingletonScope();

//managementDashboard
container.bind<ManagementDashService>(TYPES.ManagementDashService).to(ManagementDashService).inSingletonScope();
container.bind< ManagementDashController >(TYPES.ManagementDashController ).to( ManagementDashController ).inSingletonScope();
//inventoryStock
container.bind<InventoryStockRepository>(TYPES.InventoryStockRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(InventoryStock).extend(InventoryStockRepository);
}).inRequestScope();


container.bind<InventoryStockController>(TYPES.InventoryStockController).to(InventoryStockController).inSingletonScope();
container.bind<InventoryStockService>(TYPES.InventoryStockService).to(InventoryStockService)
container.bind<InventoryMovementService>(TYPES.InventoryMovementService).to(InventoryMovementService).inSingletonScope();


//product varient
container.bind<ProductVarientsRepository>(TYPES.ProductVarientsRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ProductVarient).extend(ProductVarientsRepository);
}).inRequestScope(); 
container.bind<ProductVarientService>(TYPES.ProductVarientService).to(ProductVarientService).inSingletonScope();
container.bind<ProductVarientController>(TYPES.ProductVarientsController).to(ProductVarientController).inSingletonScope();
//packingmaterial
container.bind<PackingMaterialRepository>(TYPES.PackingMaterialRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(PackingMaterial).extend(PackingMaterialRepository);
}).inRequestScope(); 
container.bind< PackingMaterialService >(TYPES.PackingMaterialService ).to( PackingMaterialService ).inSingletonScope();
container.bind<PackingMaterialController>(TYPES.PackingMaterialController).to(PackingMaterialController).inSingletonScope();


//docuemntType
container.bind<DocumentDefinitionRepository>(TYPES.DocumentDefinitionRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(DocumentDefinition).extend(DocumentDefinitionRepository);
}).inRequestScope(); 
container.bind< DocumentDefinitionService >(TYPES.DocumentDefinitionService ).to( DocumentDefinitionService ).inSingletonScope();
container.bind<DocumentDefinitionController>(TYPES.DocumentDefinitionController).to(DocumentDefinitionController).inSingletonScope();

//documentPermission
container.bind<DocumentPermissionRepository>(TYPES.DocumentPermissionRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(DocumentPermission).extend(DocumentPermissionRepository);
}).inRequestScope(); 
container.bind<DocumentPermissionService>(TYPES.DocumentPermissionService ).to( DocumentPermissionService ).inSingletonScope();
container.bind<DocumentPermissionController>(TYPES.DocumentPermissionController).to(DocumentPermissionController).inSingletonScope();
//docuemnt
container.bind< DocumentbRepository>(TYPES. DocumentbRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository( Documentb ).extend( DocumentbRepository);
}).inRequestScope(); 
container.bind<DocumentbService>(TYPES.DocumentbService ).to(DocumentbService ).inSingletonScope();
container.bind<DocumentbController>(TYPES.DocumentbController).to(DocumentbController).inSingletonScope();


//APProvalFlow
container.bind<ApprovalFlowRepository>(TYPES.ApprovalFlowRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ApprovalFlow ).extend(ApprovalFlowRepository);
}).inRequestScope(); 
container.bind<ApprovalFlowService>(TYPES.ApprovalFlowService ).to(ApprovalFlowService ).inSingletonScope();
container.bind<ApprovalFlowController>(TYPES.ApprovalFlowController).to(ApprovalFlowController).inSingletonScope();

//FinalizerBlock
container.bind<FinalizerBlockRepository>(TYPES.FinalizerBlockRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(FinalizerBlock ).extend(FinalizerBlockRepository);
}).inRequestScope(); 

//ApproverBlockRepository
container.bind<ApproverBlockRepository>(TYPES.ApproverBlockRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ApproverBlock ).extend(ApproverBlockRepository);
}).inRequestScope(); 

//ApprovalStageInfoRepository
container.bind<ApprovalStageInfoRepository>(TYPES.ApprovalStageInfoRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ApprovalStageInfo).extend(ApprovalStageInfoRepository);
}).inRequestScope();

//TODO: DocumentApproval
container.bind<DocumentApprovalFlowRepository>(TYPES.DocumentApprovalFlowRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(DocumentApprovalFlow).extend(DocumentApprovalFlowRepository);
}).inRequestScope();
//TODO: inwardProduct
container.bind<InwardProductRepository>(TYPES.InwardProductRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(InwardProduct).extend(InwardProductRepository);
}).inRequestScope();
//TODO: DocDoubleApproverService
container.bind<DocDoubleApproverService>(TYPES.DocDoubleApproverService).to(DocDoubleApproverService).inSingletonScope();

container.bind<DocSingalApproverService>(TYPES.DocSingalApproverService).to(DocSingalApproverService).inSingletonScope();
container.bind<AdminDashboardService>(TYPES.AdminDashboardService ).to( AdminDashboardService ).inSingletonScope();
container.bind<AdminDashboardController>(TYPES.AdminDashboardController).to(AdminDashboardController).inSingletonScope();

//productVarient

container.bind<ProductVarientRepository>(TYPES.ProductVarientRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ProductVarient).extend(ProductVarientRepository);
}).inRequestScope();
container.bind<ProductVarientsService>(TYPES.ProductVarientsService).to(ProductVarientsService).inSingletonScope();
container.bind<VarientsController>(TYPES.VarientsController).to(VarientsController).inSingletonScope();
container.bind<ExcelController>(TYPES.ExcelController).to(ExcelController).inSingletonScope();
container.bind<ActiveSessionRepository>(TYPES.ActiveSessionRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ActiveSession).extend(ActiveSessionRepository);
}).inRequestScope();

container.bind<UserReportService>(TYPES.UserReportService).to(UserReportService).inSingletonScope();
container.bind<UserReportController>(TYPES.UserReportController).to(UserReportController).inSingletonScope();
container.bind<SuperAdminController>(TYPES.SuperAdminController).to(SuperAdminController).inSingletonScope();
container.bind<SuperAdminService>(TYPES.SuperAdminService).to(SuperAdminService).inSingletonScope();


// Bind performance optimization services
container
  .bind<CacheService>(TYPES.CacheService)
  .to(CacheService)
  .inSingletonScope();

// Document Excel exports (stateless: holds only the DataSource)
container
  .bind<DocumentExportService>(TYPES.DocumentExportService)
  .to(DocumentExportService)
  .inSingletonScope();
container.bind<VouchersController>(TYPES.VouchersController).to(VouchersController);

container
  .bind<QueryOptimizerService>(TYPES.QueryOptimizerService)
  .to(QueryOptimizerService)
  .inSingletonScope();

// Bind Crystal Report service
container
  .bind<CrystalReportService>(TYPES.CrystalReportService)
  .to(CrystalReportService)
  .inSingletonScope();



container
  .bind<ProcurementCrystalReportService>(TYPES.ProcurementCrystalReportService)
  .to(ProcurementCrystalReportService)
  .inSingletonScope();

container
  .bind<ProcurementCrystalReportController>(TYPES.ProcurementCrystalReportController)
  .to(ProcurementCrystalReportController)
  .inSingletonScope();



container
  .bind<SalesCrystalReportService>(TYPES.SalesCrystalReportService)
  .to(SalesCrystalReportService)
  .inSingletonScope();

container
  .bind<SalesCrystalReportController>(TYPES.SalesCrystalReportController)
  .to(SalesCrystalReportController)
  .inSingletonScope();



container
  .bind<SSEService>(TYPES.SSEService)
  .to(SSEService)
  .inSingletonScope();

container
  .bind<SSEController>(TYPES.SSEController)
  .to(SSEController)
  .inSingletonScope();

container
  .bind<SSEHelperService>(TYPES.SSEHelperService)
  .to(SSEHelperService)
  .inSingletonScope();



container
  .bind<TestController>(TYPES.TestController)
  .to(TestController)
  .inSingletonScope();



// import { RegistrationReportService } from "./services/registrationReport.service";
// import { RegistrationReportController } from "./controllers/registrationReport.controller";

container
  .bind<UserActivityLogRepository>(TYPES.UserActivityLogRepository)
  .toDynamicValue((context) => {
    return AppDataSource.getRepository(UserActivityLog).extend(
      UserActivityLogRepository.prototype
    );
  })
  .inRequestScope();

container
  .bind<UserActivityLogService>(TYPES.UserActivityLogService)
  .to(UserActivityLogService)
  .inSingletonScope();

// container
//   .bind<LogCleanupService>(TYPES.LogCleanupService)
//   .to(LogCleanupService)
//   .inSingletonScope();

container
  .bind<UserActivityLogController>(TYPES.UserActivityLogController)
  .to(UserActivityLogController)
  .inSingletonScope();

//workflow hirachy
  container.bind<WorkflowHierarchyRepository>(TYPES.WorkflowHierarchyRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(WorkflowHierarchy).extend(WorkflowHierarchyRepository);
}).inRequestScope(); 
container.bind< WorkflowHierarchyService>(TYPES.WorkflowHierarchyService ).to( WorkflowHierarchyService ).inSingletonScope();
container.bind<WorkflowHierarchyController>(TYPES.WorkflowHierarchyController).to(WorkflowHierarchyController).inSingletonScope();

//procurmentTarget
  container.bind<ProcurementTargetRepository>(TYPES.ProcurementTargetRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ProcurementTarget).extend(ProcurementTargetRepository);
}).inRequestScope(); 
container.bind<ProcurementTargetService>(TYPES.ProcurementTargetService).to(ProcurementTargetService).inSingletonScope();
container.bind<ProcurementTargetController>(TYPES.ProcurementTargetController).to(ProcurementTargetController).inSingletonScope();
container.bind<ProcurementTargetProductRepository>(TYPES.ProcurementTargetProductRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ProcurementTargetProduct).extend(ProcurementTargetProductRepository);
}).inRequestScope();
container.bind<ProcurementTargetWeekRepository>(TYPES.ProcurementTargetWeekRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ProcurementTargetWeek).extend(ProcurementTargetWeekRepository);
}).inRequestScope();
container.bind<ProcurementTargetAchievementRepository>(TYPES.ProcurementTargetAchievementRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ProcurementAchievement).extend(ProcurementTargetAchievementRepository);
}).inRequestScope();
//salesTarget
  container.bind<SalesTargetRepository>(TYPES.SalesTargetRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(SalesTarget).extend(SalesTargetRepository);
}).inRequestScope(); 
container.bind<SalesTargetService>(TYPES.SalesTargetService).to(SalesTargetService).inSingletonScope();
container.bind<SalesTargetController>(TYPES.SalesTargetController).to(SalesTargetController).inSingletonScope();
  container.bind<SalesTargetProductRepository>(TYPES.SalesTargetProductRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(SalesTargetProduct).extend(SalesTargetProductRepository);
}).inRequestScope(); 
 container.bind<SalesTargetWeekRepository>(TYPES.SalesTargetWeekRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(SalesTargetWeek).extend(SalesTargetWeekRepository);
}).inRequestScope();
 container.bind<SalesAchievementRepository>(TYPES.SalesAchievementRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(SalesAchievement).extend(SalesAchievementRepository);
}).inRequestScope();

// //dashboard
 container.bind<DashboardService>(TYPES.DashboardService).to(DashboardService).inSingletonScope();
container.bind<WeeklyBusinessPlanService>(TYPES.WeeklyBusinessPlanService).to(WeeklyBusinessPlanService).inSingletonScope();
container.bind<DashboardController>(TYPES.DashboardController).to(DashboardController).inSingletonScope();
// //registration report
container.bind<NewRegistrationService>(TYPES.NewRegistrationService).to(NewRegistrationService).inSingletonScope();
 container.bind<NewRegistrationController>(TYPES.NewRegistrationController).to(NewRegistrationController).inSingletonScope();

//report
container.bind<ReportService>(TYPES.ReportService).to(ReportService).inSingletonScope();
container.bind<SalesReportService>(TYPES.SalesReportService).to(SalesReportService).inSingletonScope();
container.bind<ReportController>(TYPES.ReportController).to(ReportController).inSingletonScope();
//paymentinfoforrfpa
container.bind<RfpaPaymentInfoRepository>(TYPES.RfpaPaymentInfoRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(PaymentInfoForRFPA).extend(RfpaPaymentInfoRepository);
}).inRequestScope();
  container.bind<ReturnToVendorService>(TYPES.ReturnToVendorService).to(ReturnToVendorService).inSingletonScope();
  container.bind<ReturnToVendorRepository>(TYPES.ReturnToVendorRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(ReturnToVendor).extend(ReturnToVendorRepository);
}).inRequestScope();
container.bind<ReturnToVendorController>(TYPES.ReturnToVendorController).to(ReturnToVendorController).inSingletonScope();
container.bind<FinalInvoiceService>(TYPES.FinalInvoiceService).to(FinalInvoiceService).inSingletonScope();
container.bind<FinalInvoiceController>(TYPES.FinalInvoiceController).to(FinalInvoiceController).inSingletonScope();
container.bind<FinalInvoiceReportService>(TYPES.FinalInvoiceReportService).to(FinalInvoiceReportService).inSingletonScope();
container.bind<FinalInvoiceReportController>(TYPES.FinalInvoiceReportController).to(FinalInvoiceReportController).inSingletonScope()

// role repository removed — Role is an enum in user.entity, not a TypeORM entity


// stockCorrection
container.bind<StockCorrectionRepository>(TYPES.StockCorrectionRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(StockCorrection).extend(StockCorrectionRepository);
}).inRequestScope();
container.bind<StockCorrectionService>(TYPES.StockCorrectionService).to(StockCorrectionService).inSingletonScope();
container.bind<StockCorrectionController>(TYPES.StockCorrectionController).to(StockCorrectionController).inSingletonScope();

//grnhistory
container.bind<GrnProductHistoryRepository>(TYPES.GrnProductHistoryRepository).toDynamicValue((context) => {
  const dataSource = context.container.get<DataSource>(TYPES.DataSource);
  return dataSource.getRepository(GrnProductHistory).extend(GrnProductHistoryRepository);
}).inRequestScope();
container.bind<GrnProductHistoryService>(TYPES.GrnProductHistoryService).to(GrnProductHistoryService).inSingletonScope();
export { container };
