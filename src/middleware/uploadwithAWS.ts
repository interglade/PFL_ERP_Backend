// ==================== AWS S3 UPLOAD (COMMENTED OUT) ====================
// import { S3Client } from '@aws-sdk/client-s3';
// import multer from 'multer';
// import multerS3 from 'multer-s3';
// import path from 'path'
// import AppError from '../utils/appError';

// const s3 = new S3Client({
//     credentials: {
//       accessKeyId: process.env.ACCESS_KEY!,   
//       secretAccessKey: process.env.ACCESS_SECRET!,  
//     },
//     region: process.env.REGION,   
//   });
  
//   const BUCKET_NAME = process.env.BUCKET_NAME as string;  
  
//   const storage = multerS3({
//     s3: s3,
//     bucket: BUCKET_NAME,
//     metadata: (req, file, cb) => {
//       console.log('in metadata', file);
//       cb(null, { fieldName: file.fieldname });
//     },
//     contentType: multerS3.AUTO_CONTENT_TYPE,  
//     key: (req, file, cb) => {
//       const ext = path.extname(file.originalname);  
//       console.log(`Saving file: ${file.originalname} as ${Date.now()}${ext}`);
//       cb(null, `uploads/${Date.now()}${ext}`); 
//     },
//   });
  
//   const uploadFile = multer({
//     storage,
//     limits: {
//       fileSize: 1 * 1024 * 1024, 
//     },
//     fileFilter: (req, file, cb) => {
//       const allowedTypes = /jpg|jpeg|png|pdf|xlsx|xls/;  
//       const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
//       const mimetype = allowedTypes.test(file.mimetype);
  
//       if (extname && mimetype) {
//         return cb(null, true);  
//       } else {
//         return cb(new AppError(400 , 'Only JPG, JPEG, PNG images, and PDFs are allowed!')); 
//       }
//     },
//   });

//   export { uploadFile};

// ==================== LOCAL STORAGE (ACTIVE) ====================
// import multer from 'multer';
// import path from 'path';
// import fs from 'fs';
// import AppError from '../utils/appError';

// // Ensure upload directory exists
// const uploadDir = 'uploads';
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir, { recursive: true });
//   console.log(`✅ Created upload directory: ${uploadDir}`);
// }

// // Configure local disk storage
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     console.log('📁 Storing file locally:', file.originalname);
//     cb(null, uploadDir);
//   },
//   filename: (req, file, cb) => {
//     const ext = path.extname(file.originalname);
//     const timestamp = Date.now();
//     const filename = `${timestamp}${ext}`;
//     console.log(`💾 Saving file: ${file.originalname} as ${filename}`);
//     cb(null, filename);
//   },
// });

// const uploadFile = multer({
//   storage,
//   limits: {
//     fileSize: 5 * 1024 * 1024, // 5 MB limit (increased from 1 MB)
//   },
//   fileFilter: (req, file, cb) => {
//     const allowedTypes = /jpg|jpeg|png|pdf|xlsx|xls/;
//     const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
//     const mimetype = allowedTypes.test(file.mimetype);

//     if (extname && mimetype) {
//       return cb(null, true);
//     } else {
//       return cb(new AppError(400, 'Only JPG, JPEG, PNG images, PDFs, and Excel files are allowed!'));
//     }
//   },
// });

// export { uploadFile };
