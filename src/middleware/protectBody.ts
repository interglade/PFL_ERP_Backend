import { NextFunction, Request, Response } from 'express';

/**
 * Fields a client must never set through an edit: identity, ownership, approval state and
 * soft-delete flags. Many update services copy the request body onto the record
 * (Object.assign / spread), so these are removed before the controller runs.
 */
const PROTECTED_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'isDeleted',
  'deletion_scheduled_at',
  'status',
  'approvalStatus',
  'approvalInfo',
  'approvedBy',
  'approvedAt',
  'createdBy',
  'requestedBy',
  'lastActionBy',
  'document',
  'documentId',
];

/** Must run after any upload middleware (multer fills req.body on multipart routes). */
export const protectBody = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const field of PROTECTED_FIELDS) delete req.body[field];
  }
  next();
};
