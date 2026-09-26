// src/types.ts
const TYPES = {
  //SocketIoServer: Symbol.for("SocketIoServer"),
  // SocketIoServerOne: Symbol.for("SocketIoServerOne"),
  //--------User-----------
  UserController: Symbol.for("UserController"),
  UserService: Symbol.for("UserService"),
  UserRepository: Symbol.for("UserRepository"),
  AuthController: Symbol.for("AuthController"),

  
  //--------VendorCategory----------
  VendorCategoryService: Symbol.for("VendorCategoryService"),
  VendorCategoryRepository: Symbol.for("VendorCategoryRepository"),
  VendorCategoryController: Symbol.for("VendorCategoryController"),

  // DataSource
  DataSource: Symbol.for("DataSource"),
  FileController: Symbol.for("FileController"),
  // address
  AddressRepository: Symbol.for("AddressRepository"),
  AddressService: Symbol.for("AddressService"),
  AddressController:Symbol.for("AddressController"),

  //-------VendorSubcategory--------------------------------------
  VendorSubcategoryService: Symbol.for("VendorSubcategoryService"),
  VendorSubcategoryRepository: Symbol.for("VendorSubcategoryRepository"),
  VendorSubcategoryController: Symbol.for("VendorSubcategoryController"),

  //-------------Vendor-------------------------------------------------
  VendorService: Symbol.for("VendorService"),
  VendorRepository: Symbol.for("VendorRepository"),
  VendorController: Symbol.for("VendorController"),
  //-------------customer-----------------
  CustomerService: Symbol.for("CustomerService"),
  CustomerRepository: Symbol.for("CustomerRepository"),
  CustomerController: Symbol.for("CustomerController"),

  //-------------customertype-----------------
  CustomerTypeService: Symbol.for("CustomerTypeService"),
  CustomerTypeRepository: Symbol.for("CustomerTypeRepository"),
  CustomerTypeController: Symbol.for("CustomerTypeController"),
  //-------------customercategory-----------------
  CustomerCategoryService: Symbol.for("CustomerCategoryService"),
  CustomerCategoryRepository: Symbol.for("CustomerCategoryRepository"),
  CustomerCategoryController: Symbol.for("CustomerCategoryController"),

  //-------------bankdeatilsconst----------------------
  // BankDetailsCustService: Symbol.for("BankDetailsCustService"),
   BankDetailsCustRepository: Symbol.for("BankDetailsCustRepository"),
  // BankDetailsCustController: Symbol.for("BankDetailsCustController"),
  // //--------------farmer-------------------
  FarmerService: Symbol.for("FarmerService"),
  FarmerRepository: Symbol.for("FarmerRepository"),
  FarmerController: Symbol.for("FarmerController"),

  //--------------Crop-------------------
 
  CropRepository: Symbol.for("CropRepository"),

  //---------------UOM------------------------
  UOMService: Symbol.for("UOMService"),
  UOMRepository: Symbol.for("UOMRepository"),
  UOMController: Symbol.for("UOMController"),
  //----------------------UOMConversionMatrix--------------------
  UOMConversionMatrixService: Symbol.for("UOMConversionMatrixService"),
  UOMConversionMatrixController: Symbol.for("UOMConversionMatrixController"),
  UOMConversionMatrixRepository: Symbol.for("UOMConversionMatrixRepository"),
  //--------------------------------Product_category----------------
  ProductCategoryService: Symbol.for("ProductCategoryService"),
  ProductCategoryRepository: Symbol.for("ProductCategoryRepository"),
  ProductCategoryController: Symbol.for("ProductCategoryController"),
  //---------------------------Product_Subcategory----------------------
  ProductSubcategoryService: Symbol.for("ProductSubcategoryService"), // Add this line
  ProductSubcategoryRepository: Symbol.for("ProductSubcategoryRepository"),
  ProductSubcategoryController: Symbol.for("ProductSubcategoryController"),

  //--------------------------Product--------------------------------------
  ProductService: Symbol.for("ProductService"),
  ProductRepository: Symbol.for("ProductRepository"),
  ProductController: Symbol.for("ProductController"),
  //---------------------------location---------
  LocationsService: Symbol.for("LocationsService"),
  LocationsRepository: Symbol.for("LocationsRepository"),
  LocationsController: Symbol.for("LocationsController"),

  //-----------------------driver----------------
  DriversService: Symbol.for("DriversService"),
  DriverRepository: Symbol.for("DriverRepository"),
  DriverController: Symbol.for("DriverController"),
  //-------------------------productClassification--------------------
  ProductClassificationService: Symbol.for("ProductClassificationService"),
  ProductClassificationRepository: Symbol.for(
    " ProductClassificationRepository"
  ),
  ProductClassificationController: Symbol.for(
    "ProductClassificationController"
  ),
  //---------------------billingdetailscust--------------------------------

  // BillingDetailsCustService: Symbol.for("BillingDetailsCustService"),
   BillingDetailsCustRepository: Symbol.for("BillingDetailsCustRepository"),
  // BillingDetailsCustController: Symbol.for("BillingDetailsCustController"),

  //---------------------billingdetailscust--------------------------------

  BranchessService: Symbol.for("BranchessService"),
  BranchessRepository: Symbol.for("BranchessRepository"),
  BranchessController: Symbol.for("BranchessController"),

  //-----------------------------Office-----------------

  OfficesService: Symbol.for("OfficesService"),
  OfficesRepository: Symbol.for("OfficesRepository"),
  OfficesController: Symbol.for("OfficesController"),

  //-----------------------delivery-details--------------
  DeliveryDetailsCustRepository: Symbol.for(" DeliveryDetailsCustRepository"),
  //-------------------statutoryDeatils----------------------
  StatutoryDetailsCustRepository: Symbol.for("StatutoryDetailsCustRepository"),

  //------------------------productspecificationcustomer-------------
  ProductSpecificationCustRepository: Symbol.for(
    "ProductSpecificationCustRepository"
  ),
  // ProductSpecificationCustService: Symbol.for(
  //   "ProductSpecificationCustService"
  // ),
  // ProductSpecificationCustController: Symbol.for(
  //   "ProductSpecificationCustController"
  // ),

  //---------------------vendorSaleinfo-----------
  VendorSaleInfoRepository: Symbol.for("VendorSaleInfoRepository"),
  VendorSaleInfoService: Symbol.for("VendorSaleInfoService"),
  //----------------------vendorbankdetails---------------------------
  BankDetailsvendRepository: Symbol.for("BankDetailsvendRepository"),
  BankDetailsvendService: Symbol.for("BankDetailsvendService"),

  //payment-terms-customer
  PaymentTermsService: Symbol.for("PaymentTermsService"),
  PaymentTermsRepository: Symbol.for("PaymentTermsRepository"),

  //keymobilenumber-customer

  KeyMobileNoDataRepository: Symbol.for("KeyMobileNoDataRepository"),
  KeyMobileNoDataService: Symbol.for("KeyMobileNoDataService"),

  //officeUseOnlyCust
  OfficeUseOnlyCustRepository: Symbol.for("OfficeUseOnlyCustRepository"),
  OfficeUseOnlyCustService: Symbol.for("OfficeUseOnlyCustService"),
  //rfpa
  RfpaRepository: Symbol.for("RfpaRepository"),
  RfpaService: Symbol.for("RfpaService"),
  RfpaController: Symbol.for("RfpaController"),

  //deal slip
  DealSlipRepository: Symbol.for("DealSlipRepository"),
  DealSlipService: Symbol.for("DealSlipService"),
  DealSlipController: Symbol.for("DealSlipController"),

  //grn
  GrnRepository: Symbol.for("GrnRepository"),
  GrnService: Symbol.for("GrnService"),
  GrnController: Symbol.for("GrnController"),
  GrnReportService: Symbol.for("GrnReportService"),
  GrnReportController: Symbol.for("GrnReportController"),
  
  //delivery challan report
  DeliveryChallanReportService: Symbol.for("DeliveryChallanReportService"),
  DeliveryChallanReportController: Symbol.for("DeliveryChallanReportController"),
  //grnProduct
  GrnProductRepository: Symbol.for("GrnProductRepository"),
  GrnProductService: Symbol.for("GrnProductService"),

  //nofication
  NotificationRepository: Symbol.for("NotificationRepository"),
  NotificationService: Symbol.for("NotificationService"),
  NotificationController: Symbol.for("NotificationController"),

  //transportPaymentvoucher
  TPVoucherService: Symbol.for("TPVoucherService"),
  TPVoucherRepository: Symbol.for("TPVoucherRepository"),
  TPVoucherController: Symbol.for("TPVoucherController"),
  //packingMaterialPaymentVoucher
  PMPVoucherRepository: Symbol.for("PMPVoucherRepository"),
  PMPVoucherService: Symbol.for("PMPVoucherService"),
  PMPVoucherController: Symbol.for("PMPVoucherController"),

  //multiCashVoucher
  MultiCashVoucherRepository: Symbol.for("MultiCashVoucherRepository"),
  MultiCashVoucherService: Symbol.for("MultiCashVoucherService"),
  MultiCashVoucherController: Symbol.for("MultiCashVoucherController"),

  //labour-payment-voucher
  LabourPaymentVoucherRepository: Symbol.for("LabourPaymentVoucherRepository"),
  LabourPaymentVoucherService: Symbol.for("LabourPaymentVoucherService"),
  LabourPaymentVoucherController: Symbol.for("LabourPaymentVoucherController"),

  //Approval status
  ApprovalLevelController: Symbol.for("ApprovalLevelController"),
  ApprovalLevelRepository: Symbol.for("ApprovalLevelRepository"),
  ApprovalLevelService: Symbol.for("ApprovalLevelService"),

  //deliveryChallan
  DitemRepository: Symbol.for("DitemRepository"),
  DeliveryChallanService: Symbol.for("DeliveryChallanService"),
  DeliveryChallanRepository: Symbol.for("DeliveryChallanRepository"),
  DeliveryChallanController: Symbol.for("DeliveryChallanController"),
//CustomerdeliveyChallan 
  CustomerDeliveryChallanRepository: Symbol.for("CustomerDeliveryChallanRepository"),
  CustomerDeliveryChallanService: Symbol.for("CustomerDeliveryChallanService"),
  CustomerDeliveryChallanController: Symbol.for("CustomerDeliveryChallanController"),

  //Tranfer Delivery Challan
  StockTransferDeliveryChallanRepository:Symbol.for("StockTransferDeliveryChallanRepository"),
  StockTransferDeliveryChallanService:Symbol.for("StockTransferDeliveryChallanService"),
  StockTranferDeliveryChallanController:Symbol.for("StockTranferDeliveryChallanController"),

//other Delivery Challan
OtherDeliveryChallanService : Symbol.for("OtherDeliveryChallanService"),
OtherDeliveryChallanRepository:Symbol.for("OtherDeliveryChallanRepository"),
OtherDeliveryChallanController:Symbol.for("OtherDeliveryChallanController"),
  //payment request
  PaymentRequestService: Symbol.for("PaymentRequestService"),
  PaymentRequestRepository: Symbol.for("PaymentRequestRepository"),
  PaymentRequestController: Symbol.for("PaymentRequestController "),
  //auditlog
  AuditLogService: Symbol.for("AuditLogService"),
  AuditLogRepository: Symbol.for("AuditLogRepository"),
  AuditLogController: Symbol.for("AuditLogController"),
  //userSystemInfo
  UserSystemInfoRepository: Symbol.for("UserSystemInfoRepository"),
  UserSystemInfoService: Symbol.for("UserSystemInfoService"),

  //request
  RequestsService: Symbol.for("RequestsService"),
  RequestsRepository: Symbol.for("RequestsRepository"),
  //levels
  LevelsService: Symbol.for("LevelsService"),
  LevelsRepository: Symbol.for("LevelsRepository"),
  LevelsController: Symbol.for("LevelsController"),

  //inwardRegister
  InwardRegisterController: Symbol.for("InwardRegisterController"),
  InwardRegisterService: Symbol.for("InwardRegisterService"),
  InwardRepository: Symbol.for("InwardRepository"),
  //department to approve
  DepartmentforApproveRepository: Symbol.for("DepartmentforApproveRepository"),

  //labour register
  LaborRegisterRepository: Symbol.for("LaborRegisterRepository"),
  LaborRegisterService: Symbol.for("LaborRegisterService"),
  LaborRegisterController: Symbol.for("LaborRegisterController"),

  //labour attendence
  LaborAttendancesService: Symbol.for("LaborAttendancesService"),
  LaborAttendancesRepository: Symbol.for("LaborAttendancesRepository"),
  LaborAttendancesController: Symbol.for("LaborAttendancesController"),

  //main labour
  LaborService: Symbol.for("LaborService"),
  LaborRepository: Symbol.for("LaborRepository"),
  LaborController: Symbol.for("LaborController"),

  //dump register
  DumpRegisterRepository: Symbol.for("DumpRegisterRepository"),
  DumpRegisterService: Symbol.for("DumpRegisterService"),
  DumpRegisterController: Symbol.for("DumpRegisterController"),
//dump product

DumpProductRepository:Symbol.for("DumpProductRepository"),
//dump summary

  //sku for eod
  SkuEodRepository: Symbol.for("SkuEodRepository"),
  SKUEodStockService: Symbol.for("SKUEodStockService"),
  SkuEodStockController: Symbol.for("SkuEodStockController"),

  //eod stock
  EodRepository: Symbol.for("EodRepository"),
  EodStockService: Symbol.for("EodStockService"),
  EodStockController: Symbol.for("EodStockController"),

  //Vehicle Dispatch Register
  VehicleDispatchRepository: Symbol.for("VehicleDispatchRepository"),
  VehicleDispatchService: Symbol.for("VehicleDispatchService"),
  VehicleDispatchController: Symbol.for(" VehicleDispatchController"),

  //AQR
  AqrRepository: Symbol.for("AqrRepository"),
  AqrService: Symbol.for("AqrService"),
  AqrController: Symbol.for("AqrController"),

  //quality parameter
  QualityParameterRepository: Symbol.for("QualityParameterRepository"),
  //second sale
  SecondSaleService: Symbol.for("SecondSaleService"),
  SecondSaleRepository: Symbol.for("SecondSaleRepository"),
  SecondSaleController: Symbol.for("SecondSaleController"),
  //second sale product
  SecondSaleProductRepository : Symbol.for("SecondSaleProductRepository"),
  //----------------daily inward summary ---------------------

 

  
  //sale order
  SaleOrderService:Symbol.for("SaleOrderService"),
  SaleOrderRepository:Symbol.for("SaleOrderRepository"),
  SaleOrderController:Symbol.for("SaleOrderController"),

    //invoice
    InvoiceRepository:Symbol.for("InvoiceRepository"),
    InvoiceProductRepository:Symbol.for("InvoiceProductRepository"),
  
   //return by customer
    PostReturnByCustomerRepository:Symbol.for("PostReturnByCustomerRepository"),
    PostReturnByCustomerService:Symbol.for("PostReturnByCustomerService"),
    ReturnByCustomerController:Symbol.for("ReturnByCustomerController"),
    //return by customer product
    ReturnedProductsRepository:Symbol.for("ReturnedProductsRepository"),
    //pdf generator
    PdfGeneratorService:Symbol.for("PdfGeneratorService"),

    //company 
    CompanyService:Symbol.for("CompanyService"),
    CompanyRepository:Symbol.for("CompanyRepository"),
    CompanyController:Symbol.for("CompanyController"),

    //procurmentDashboard
    ProcurmentDashService:Symbol.for("ProcurmentDashService"),
    ProcurmentDashController :Symbol.for("ProcurmentDashController"),

    //managementDashboard
    ManagementDashService:Symbol.for("ManagementDashService"),
    ManagementDashController:Symbol.for("ManagementDashController"),
    //inventoryStock
    InventoryStockService:Symbol.for("InventoryStockService"),
    InventoryStockRepository :Symbol.for("InventoryStockRepository"),
    InventoryStockController:Symbol.for("InventoryStockController"),
    InventoryMovementService:Symbol.for("InventoryMovementService"),

//product varient
ProductVarientsRepository:Symbol.for("ProductVarientsRepository"),
ProductVarientService:Symbol.for("ProductVarientService"),
ProductVarientsController:Symbol.for("ProductVarientsController"),
//packingMaterial
PackingMaterialRepository:Symbol.for("PackingMaterialRepository"),
PackingMaterialService :Symbol.for("PackingMaterialService"),
PackingMaterialController:Symbol.for("PackingMaterialController"),
//documentDefinition
DocumentDefinitionRepository:Symbol.for("DocumentDefinitionRepository"),
DocumentDefinitionService:Symbol.for("DocumentDefinitionService"),
DocumentDefinitionController:Symbol.for("DocumentDefinitionController"),
//documentPermission
DocumentPermissionRepository:Symbol.for("DocumentPermissionRepository"),
DocumentPermissionService:Symbol.for("DocumentPermissionService"),
DocumentPermissionController:Symbol.for("DocumentPermissionController"),
//docuemnt
 DocumentbRepository:Symbol.for("DocumentbRepository"),
 DocumentbService:Symbol.for("DocumentbService"),
 DocumentbController:Symbol.for("DocumentbController"),
ApprovalFlowService:Symbol.for("ApprovalFlowService"),
ApprovalFlowRepository:Symbol.for("ApprovalFlowRepository"),
ApprovalFlowController:Symbol.for("ApprovalFlowController"),

FinalizerBlockRepository:Symbol.for("FinalizerBlockRepository"),
ApproverBlockRepository:Symbol.for("ApproverBlockRepository"),

  //TODO: By Shri
  ApprovalStageInfoRepository: Symbol.for("ApprovalStageInfoRepository"),
  DocumentApprovalFlowRepository: Symbol.for("DocumentApprovalFlowRepository"),
  DocDoubleApproverService: Symbol.for("DocDoubleApproverService"),

  DocSingalApproverService: Symbol.for("DocSingalApproverService"),
   AdminDashboardController: Symbol.for("AdminDashboardController"),
  AdminDashboardService: Symbol.for("AdminDashboardService"),
  WeeklyBusinessPlanService: Symbol.for("WeeklyBusinessPlanService"),

  InwardProductRepository:Symbol.for("InwardProductRepository"),
  ProductVarientRepository:Symbol.for("ProductVarientRepository"),
  ProductVarientsService:Symbol.for("ProductVarientsService"),
  VarientsController:Symbol.for("VarientsController"),
  ExcelController:Symbol.for("ExcelController"),
  ActiveSessionRepository:Symbol.for("ActiveSessionRepository"),

UserReportService:Symbol.for("UserReportService"),
UserReportController:Symbol.for("UserReportController"),
SuperAdminService:Symbol.for("SuperAdminService"),
SuperAdminController:Symbol.for("SuperAdminController"),

// Performance optimization services
CacheService: Symbol.for("CacheService"),
QueryOptimizerService: Symbol.for("QueryOptimizerService"),

// Crystal Report services
CrystalReportService: Symbol.for("CrystalReportService"),
 // Procurement Crystal Report
ProcurementCrystalReportService: Symbol.for("ProcurementCrystalReportService"),
ProcurementCrystalReportController: Symbol.for("ProcurementCrystalReportController"),
// Sales Crystal Report
SalesCrystalReportService: Symbol.for("SalesCrystalReportService"),
SalesCrystalReportController: Symbol.for("SalesCrystalReportController"),
// SSE (Server-Sent Events) for notifications
SSEService: Symbol.for("SSEService"),
SSEController: Symbol.for("SSEController"),
SSEHelperService: Symbol.for("SSEHelperService"),
// Test Controller for SSE
TestController: Symbol.for("TestController"),

// User Activity Logging
UserActivityLogRepository: Symbol.for("UserActivityLogRepository"),
UserActivityLogService: Symbol.for("UserActivityLogService"),
UserActivityLogController: Symbol.for("UserActivityLogController"),
LogCleanupService: Symbol.for("LogCleanupService"),
//workflowhirarchy
WorkflowHierarchyController:Symbol.for("WorkflowHierarchyController"),
  WorkflowHierarchyService:Symbol.for("WorkflowHierarchyService"),
  WorkflowHierarchyRepository:Symbol.for("WorkflowHierarchyRepository"),
  //procurment target
  ProcurementTargetController:Symbol.for("ProcurementTargetController"),
  ProcurementTargetService:Symbol.for("ProcurementTargetService"),
  ProcurementTargetRepository:Symbol.for("ProcurementTargetRepository"),
  ProcurementTargetWeekRepository:Symbol.for("ProcurementTargetWeekRepository"),
  ProcurementTargetAchievementRepository:Symbol.for("ProcurementTargetAchievementRepository"),
  ProcurementTargetProductRepository:Symbol.for("ProcurementTargetProductRepository"),
  //sales target
  SalesTargetRepository:Symbol.for("SalesTargetRepository"),
  SalesTargetService:Symbol.for("SalesTargetService"),
  SalesTargetController:Symbol.for("SalesTargetController"),
  SalesTargetProductRepository:Symbol.for("SalesTargetProductRepository"),
  SalesTargetWeekRepository:Symbol.for("SalesTargetWeekRepository"),
  SalesAchievementRepository:Symbol.for("SalesAchievementRepository"),
  //dashboard
  DashboardService:Symbol.for("DashboardService"),
  DashboardController:Symbol.for("DashboardController"),
  //registration report
  RegistrationReportController:Symbol.for("RegistrationReportController"),
  RegistrationReportService:Symbol.for("RegistrationReportService"),
  
  //new registration report
  NewRegistrationController:Symbol.for("NewRegistrationController"),
  NewRegistrationService:Symbol.for("NewRegistrationService"),

  //report
  ReportController:Symbol.for("ReportController"),
  ReportService:Symbol.for("ReportService"),
  SalesReportService:Symbol.for("SalesReportService"),
RfpaPaymentInfoRepository:Symbol.for("RfpaPaymentInfoRepository"),
RegistrationReportsController:Symbol.for("RegistrationReportsController"),
  ReturnToVendorService:Symbol.for("ReturnToVendorService"),
  ReturnToVendorRepository:Symbol.for("ReturnToVendorRepository"),
  ReturnToVendorController:Symbol.for("ReturnToVendorController"),
  FinalInvoiceService:Symbol.for("FinalInvoiceService"),
  FinalInvoiceController:Symbol.for("FinalInvoiceController"),
  FinalInvoiceReportController:Symbol.for("FinalInvoiceReportController"),
  FinalInvoiceReportService:Symbol.for("FinalInvoiceReportService"),

  //role
  RoleRepository: Symbol.for("RoleRepository"),

  // stockCorrection
  StockCorrectionRepository: Symbol.for("StockCorrectionRepository"),
  StockCorrectionService: Symbol.for("StockCorrectionService"),
  StockCorrectionController: Symbol.for("StockCorrectionController"),
    GrnProductHistoryRepository:Symbol.for("GrnProductHistoryRepository"),
    GrnProductHistoryService:Symbol.for("GrnProductHistoryService"),

  // Document Excel exports
  DocumentExportService: Symbol.for("DocumentExportService"),
  VouchersController: Symbol.for("VouchersController"),
};

export { TYPES };






