export interface PaymentTermsDto {
  id?: string;
  paymentMode?: string;

  otherPaymentMode?: string;

  otherPaymentMade?: string;

  paymentMade?: string;

  marginDeposit?: string;

  rtv?: boolean;

  agreementExecuted?: boolean;

  lc?: string;

  bg?: string;

  securityDepoCheqNo?: string;

  securityDepoAmt?: number;

  IELinAmt?: number;

  IELRecommendedBy?: string;

  IELRecommendedDate?: Date;

  RELinAmt?: number;

  RELRecommendedBy?: string;

  RELRecommendedDate?: Date;

  reason?: string;

  docEvidenceCopy?: string;
}