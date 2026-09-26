import multer from 'multer';
import multerS3 from 'multer-s3';
import { s3 } from './spaces.config';

/**
 * Array Upload Middleware for DigitalOcean Spaces
 * 
 * For uploading multiple files with the SAME field name
 * 
 * Usage:
 * @httpPost('/endpoint', uploadArray.array('fieldName', maxCount))
 * 
 * Access uploaded files:
 * const fileUrls = req.files.map(file => file.location);
 * 
 * Example:
 * uploadArray.array('productImages', 5)  // Max 5 images
 * 
 * req.files = [
 *   { location: "https://prime-fresh-storage.blr1.digitaloceanspaces.com/array/1234567890-image1.jpg" },
 *   { location: "https://prime-fresh-storage.blr1.digitaloceanspaces.com/array/1234567891-image2.jpg" },
 *   { location: "https://prime-fresh-storage.blr1.digitaloceanspaces.com/array/1234567892-image3.jpg" }
 * ]
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

export const uploadArray = multer({
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per file
    files: 10, // Maximum 10 files in array
  },
  storage: multerS3({
    s3,
    bucket: process.env.DO_SPACES_BUCKET!,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileName = `${timestamp}-${random}-${sanitizedFilename}`;
      cb(null, `array/${fileName}`);
    },
  }),
});
