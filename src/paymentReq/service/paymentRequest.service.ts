import { inject, injectable } from "inversify";
import { TYPES } from "../../types";
import { PaymentRequestRepository } from "../repository/paymentRequest.repository";
import { PaymentRequest } from "../entity/paymentRequest.entity";
import { GrnRepository } from "../../grn/repository/grn.repository";
import { AuditLogService } from "../../employeeActivity/service/auditLog.service";
import AppError from "../../utils/appError";


@injectable()
export class PaymentRequestService {
  constructor(
    @inject(TYPES.PaymentRequestRepository)
    private readonly paymentRequestRepository: PaymentRequestRepository,
    @inject(TYPES.GrnRepository)
    private readonly grnRepository: GrnRepository,
    @inject(TYPES.AuditLogService)private readonly auditLogService: AuditLogService,
  ) {}


 // Service: PaymentRequestService

async createPaymentRequest(data: Partial<PaymentRequest>, grnId: string): Promise<any> {
  // Find the GRN entity by ID to associate with the PaymentRequest
  const grn = await this.grnRepository.findOne({ where: { id: grnId } });

  if (!grn) {
    throw new Error("GRN not found");
  }

  // Create a new PaymentRequest with the provided data
  const paymentRequest = this.paymentRequestRepository.create({
    ...data,
    grn, // Assign the GRN entity to the payment request
  });

  // Save and return the created PaymentRequest
  return this.paymentRequestRepository.save(paymentRequest);
}


async getPaymentRequestById(id: string): Promise<any> {
  // Fetch the payment request by id, including the requestedBy user and grn relations
  const paymentRequest = await this.paymentRequestRepository.findOne({
    where: { id },
    relations: ['requestedBy', 'grn'], // Ensure both 'requestedBy' and 'grn' relations are loaded
  });

  // If no record found, return null
  if (!paymentRequest) {
    return null;
  }

  // Shape the response to match the desired output
  const response = {
    id: paymentRequest.id,
    createdAt: paymentRequest.createdAt,
    updatedAt: paymentRequest.updatedAt,
    paymentDate: paymentRequest.paymentDate,
    partyName: paymentRequest.partyName,
    amount: paymentRequest.amount,
    bankAccNo: paymentRequest.bankAccNo,
    ifscCode: paymentRequest.ifscCode,
    paymentMode: paymentRequest.paymentMode,
    typesOfTransaction: paymentRequest.typesOfTransaction,
    otherTransaction: paymentRequest.otherTransaction,
    vehicleNo: paymentRequest.vehicleNo,
    placeOfPurchase: paymentRequest.placeOfPurchase,
    contactpersonRec: paymentRequest.contactpersonRec,
    contactpersonSen: paymentRequest.contactpersonSen,
    costCenter: paymentRequest.costCenter,
    kycByEmail: paymentRequest.kycByEmail,
    remark: paymentRequest.remark,
    requestedBy: {
      id: paymentRequest.requestedBy?.id, // Include requestedBy id
      firstName: paymentRequest.requestedBy?.firstName, // Include requestedBy firstName
      lastName: paymentRequest.requestedBy?.lastName, // Include requestedBy lastName
    },
    grn: paymentRequest.grn ? paymentRequest.grn.id : null // Check if grn exists before accessing its id
  };

  return response;
}

  
// Get all PaymentRequests
async getAllPaymentRequests(): Promise<any[]> {
  // Fetch all payment requests, including the 'requestedBy' and 'grn' relations
  const paymentRequests = await this.paymentRequestRepository.find({
    relations: ['requestedBy', 'grn'], // Ensure the 'requestedBy' and 'grn' relations are loaded
  });

  // Map through the results to shape the response for each PaymentRequest
  const response = paymentRequests.map(paymentRequest => ({
    id: paymentRequest.id,
    createdAt: paymentRequest.createdAt,
    updatedAt: paymentRequest.updatedAt,
    paymentDate: paymentRequest.paymentDate,
    partyName: paymentRequest.partyName,
    amount: paymentRequest.amount,
    bankAccNo: paymentRequest.bankAccNo,
    ifscCode: paymentRequest.ifscCode,
    paymentMode: paymentRequest.paymentMode,
    typesOfTransaction: paymentRequest.typesOfTransaction,
    otherTransaction: paymentRequest.otherTransaction,
    vehicleNo: paymentRequest.vehicleNo,
    placeOfPurchase: paymentRequest.placeOfPurchase,
    contactpersonRec: paymentRequest.contactpersonRec,
    contactpersonSen: paymentRequest.contactpersonSen,
    costCenter: paymentRequest.costCenter,
    kycByEmail: paymentRequest.kycByEmail,
    remark: paymentRequest.remark,
    grn: paymentRequest.grn ? paymentRequest.grn.id : null, // Check if grn exists before accessing its id
    requestedBy: paymentRequest.requestedBy ? {
      id: paymentRequest.requestedBy.id, // Include requestedBy id
      firstName: paymentRequest.requestedBy.firstName, // Include requestedBy firstName
      lastName: paymentRequest.requestedBy.lastName, // Include requestedBy lastName
    } : null // If requestedBy doesn't exist, return null
  }));

  return response;
}

public async updatePaymentRequest(
  id: string,
  data: Partial<PaymentRequest>,
  updatedBy: string
): Promise<PaymentRequest | null> {
  // Step 1: Retrieve the current state of the payment request
  const existingPaymentRequest = await this.paymentRequestRepository.findOne({ where: { id } });
  if (!existingPaymentRequest) {
    throw new Error(`Payment request with ID ${id} not found`);
  }

  // Step 2: Log the changes for audit purposes
  await this.auditLogService.logChange(
    'PaymentRequest',
    id,
    existingPaymentRequest,
    data,
    updatedBy
  );

  // Step 3: Update the payment request in the database
  await this.paymentRequestRepository.update(id, data);

  // Step 4: Fetch and return the updated payment request
  return this.paymentRequestRepository.findOne({ where: { id } });
}


async deletePaymentRequest(id: string): Promise<boolean> {
  // Find the payment request by ID
  const paymentRequest = await this.paymentRequestRepository.findOne({ where: { id } });

  if (!paymentRequest) {
    throw new AppError(404, `Payment Request with ID ${id} not found`);
  }

  // Calculate the date 6 months ahead
  const now = new Date();
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setMonth(now.getMonth() + 6); // Adds 6 months to the current date
  sixMonthsFromNow.setHours(0, 0, 0, 0); // Optionally, set the time to midnight (00:00:00)



  // Set the deletionScheduledAt field for the payment request
  paymentRequest.deletionScheduledAt = sixMonthsFromNow;

  // Save the updated payment request with the scheduled deletion date
  await this.paymentRequestRepository.save(paymentRequest);


  return true;
}

}
