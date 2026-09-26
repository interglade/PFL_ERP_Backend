import multer from 'multer';
import multerS3 from 'multer-s3';
import { s3 } from './spaces.config';

/**
 * Single File Upload Middleware for DigitalOcean Spaces
 * 
 * Usage:
 * @httpPost('/endpoint', uploadSingle.single('fieldName'))
 * 
 * Access uploaded file:
 * const fileUrl = req.file.location;
 * 
 * Example:
 * uploadSingle.single('profileImage')
 * req.file.location = "https://prime-fresh-storage.blr1.digitaloceanspaces.com/single/1234567890-image.jpg"
 */

const fileFilter: multer.Options['fileFilter'] = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
    'image/gif',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, PDFs, and Excel/CSV files are allowed.'));
  }
};

// Use a factory function so multerS3 is initialized lazily at request time,
// not at module load time — prevents "bucket is required" when env vars
// haven't been loaded yet during startup
const createUploadSingle = () =>
  multer({
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
        cb(null, `single/${fileName}`);
      },
    }),
  });

export const uploadSingle = new Proxy({} as ReturnType<typeof createUploadSingle>, {
  get(_target, prop) {
    return createUploadSingle()[prop as keyof ReturnType<typeof createUploadSingle>];
  },
});
