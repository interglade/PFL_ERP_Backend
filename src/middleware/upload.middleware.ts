import multer, { MulterError } from 'multer';
import multerS3 from 'multer-s3';
import { s3 } from './spaces.config';
import { Request, Response, NextFunction, RequestHandler } from 'express';

const fileFilter: multer.Options['fileFilter'] = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPEG, PNG, and Excel files are allowed.'));
  }
};

export const upload = multer({
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  storage: multerS3({
    s3,
    bucket: process.env.DO_SPACES_BUCKET!,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const timestamp = Date.now();
      const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileName = `${timestamp}-${sanitizedFilename}`;
      cb(null, `documents/${fileName}`);
    },
  }),
});

// Create a flexible upload middleware that accepts both field names
export const uploadFlexible = multer({
  fileFilter: (req, file, cb) => {
    // Accept both 'anyAttachment' and 'anyAttachment[]' field names
    if (file.fieldname === 'anyAttachment' || file.fieldname === 'anyAttachment[]') {
      // Apply the original file filter
      fileFilter(req, file, cb);
    } else {
      cb(new Error(`Unexpected field name: ${file.fieldname}. Expected 'anyAttachment' or 'anyAttachment[]'`));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 5, // Maximum 5 files
  },
  storage: multerS3({
    s3,
    bucket: process.env.DO_SPACES_BUCKET!,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const timestamp = Date.now();
      const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileName = `${timestamp}-${sanitizedFilename}`;
      cb(null, `documents/${fileName}`);
    },
  }),
});

// Flexible attachment upload that accepts any field name and filters in controller
export const uploadAttachments = uploadFlexible.any();

/**
 * Wraps a multer middleware and converts MulterError "LIMIT_UNEXPECTED_FILE"
 * into a 400 response instead of a 500, making the error message clear to the client.
 */
export function handleMulterFields(fields: multer.Field[]): RequestHandler {
  const multerMiddleware = upload.fields(fields);
  return (req: Request, res: Response, next: NextFunction) => {
    multerMiddleware(req, res, (err) => {
      if (err instanceof MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          status: 'error',
          message: `Unexpected file field: "${err.field}". Please check the field names being uploaded.`,
        });
      }
      next(err);
    });
  };
}
