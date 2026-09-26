// // src/utils/logger.ts

// import { createLogger, format, transports } from 'winston';
// import path from 'path';
// import { captureUserInfo } from '../middleware/capturesystemInfo';

// // Directory for log files
// const logDirectory = process.env.LOG_DIR || path.join(__dirname, '../../logs');

// // Define custom log levels
// const levels = {
//   error: 0,
//   warn: 1,
//   info: 2,
//   http: 3,
//   debug: 4,
// };

// // Set up Winston logger configuration
// const logger = createLogger({
//   level: process.env.LOG_LEVEL || 'info', // Default to 'info' level
//   levels,
//   format: format.combine(
//     format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
//     format.errors({ stack: true }),  // Capture stack traces for errors
//     format.splat(),
//     format.json()  // Log messages in JSON format
//   ),
//   transports: [
//     // File transport for error logs
//     new transports.File({
//       filename: path.join(logDirectory, 'error.log'),
//       level: 'error',
//       maxsize: 5 * 1024 * 1024, // 5MB per file
//       maxFiles: 5,  // Rotate after 5 files
//     }),
//     // File transport for all logs
//     new transports.File({
//       filename: path.join(logDirectory, 'combined.log'),
//       maxsize: 10 * 1024 * 1024, // 10MB per file
//       maxFiles: 5,
//     }),
//   ],
// });

// // Optionally log to console in development
// if (process.env.NODE_ENV !== 'production') {
//   logger.add(
//     new transports.Console({
//       format: format.combine(
//         format.colorize(),
//         format.printf(({ level, message, timestamp, stack }) => {
//           return `${timestamp} [${level}]: ${stack || message}`;
//         })
//       ),
//     })
//   );
// }

// export default logger;

import { createLogger, format, transports } from 'winston';
import path from 'path';
import { format as dateFnsFormat } from 'date-fns';

// Directory for log files
const logDirectory = process.env.LOG_DIR || path.join(__dirname, '../../logs');

// Define custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Set up Winston logger configuration
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: format.combine(
    format.timestamp({
      format: () => dateFnsFormat(new Date(), 'yyyy-MM-dd hh:mm:ss a'), // AM/PM format
    }),
    format.errors({ stack: true }),
    format.printf(({ level, message, timestamp, stack, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${meta.ip ? `[IP: ${meta.ip}]` : ''}`;
    })
  ),
  transports: [
    new transports.File({
      filename: path.join(logDirectory, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    new transports.File({
      filename: path.join(logDirectory, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});

// Console transport for non-production environments
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ level, message, timestamp, stack, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${meta.ip ? `[IP: ${meta.ip}]` : ''}`;
        })
      ),
    })
  );
}

// Create a separate logger for UserLogger with custom formatting
const userLogger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: format.combine(
    format.printf(({ message }) => {
      // UserLogger will provide its own formatted message
      return message as string;
    })
  ),
  transports: [
    new transports.File({
      filename: path.join(logDirectory, 'user-activity.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new transports.Console({
      format: format.combine(
        format.printf(({ message }) => message as string)
      ),
    }),
  ],
});

// Enhanced logger with user context
export class UserLogger {
  private static getUserName(user: any): string {
    if (!user) return 'System';
    
    if (typeof user === 'string') return user;
    
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    
    if (user.firstName) return user.firstName;
    if (user.lastName) return user.lastName;
    if (user.username) return user.username;
    if (user.email) return user.email;
    if (user.id) return user.id;
    
    return 'Unknown';
  }

  static info(message: string, user?: any, additionalData?: any) {
    const userName = this.getUserName(user);
    const timestamp = dateFnsFormat(new Date(), 'yyyy-MM-dd hh:mm:ss a');
    const logMessage = `${timestamp} [info-${userName}]: ${message}`;
    
    userLogger.info(logMessage, additionalData);
  }

  static infoWithIp(message: string, user?: any, ip?: string, additionalData?: any) {
    const userName = this.getUserName(user);
    const timestamp = dateFnsFormat(new Date(), 'yyyy-MM-dd hh:mm:ss a');
    const ipInfo = ip ? ` [IP: ${ip}]` : '';
    const logMessage = `${timestamp} [info-${userName}]: ${message}${ipInfo}`;
    
    userLogger.info(logMessage, additionalData);
  }

  static error(message: string, user?: any, error?: any) {
    const userName = this.getUserName(user);
    const timestamp = dateFnsFormat(new Date(), 'yyyy-MM-dd hh:mm:ss a');
    const logMessage = `${timestamp} [error-${userName}]: ${message}`;
    
    userLogger.error(logMessage, { error: error?.stack || error });
  }

  static errorWithIp(message: string, user?: any, ip?: string, error?: any) {
    const userName = this.getUserName(user);
    const timestamp = dateFnsFormat(new Date(), 'yyyy-MM-dd hh:mm:ss a');
    const ipInfo = ip ? ` [IP: ${ip}]` : '';
    const logMessage = `${timestamp} [error-${userName}]: ${message}${ipInfo}`;
    
    userLogger.error(logMessage, { error: error?.stack || error });
  }

  static warn(message: string, user?: any, additionalData?: any) {
    const userName = this.getUserName(user);
    const timestamp = dateFnsFormat(new Date(), 'yyyy-MM-dd hh:mm:ss a');
    const logMessage = `${timestamp} [warn-${userName}]: ${message}`;
    
    userLogger.warn(logMessage, additionalData);
  }

  static warnWithIp(message: string, user?: any, ip?: string, additionalData?: any) {
    const userName = this.getUserName(user);
    const timestamp = dateFnsFormat(new Date(), 'yyyy-MM-dd hh:mm:ss a');
    const ipInfo = ip ? ` [IP: ${ip}]` : '';
    const logMessage = `${timestamp} [warn-${userName}]: ${message}${ipInfo}`;
    
    userLogger.warn(logMessage, additionalData);
  }

  static debug(message: string, user?: any, additionalData?: any) {
    const userName = this.getUserName(user);
    const timestamp = dateFnsFormat(new Date(), 'yyyy-MM-dd hh:mm:ss a');
    const logMessage = `${timestamp} [debug-${userName}]: ${message}`;
    
    userLogger.debug(logMessage, additionalData);
  }

  // User-friendly logging methods for business operations
  static logRfpaCreated(rfpaId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`RFPA created successfully with ID: ${rfpaId}`, user, ip);
    } else {
      this.info(`RFPA created successfully with ID: ${rfpaId}`, user);
    }
  }

  static logRfpaUpdated(rfpaId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`RFPA updated successfully with ID: ${rfpaId}`, user, ip);
    } else {
      this.info(`RFPA updated successfully with ID: ${rfpaId}`, user);
    }
  }

  static logRfpaViewed(rfpaId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`RFPA viewed successfully with ID: ${rfpaId}`, user, ip);
    } else {
      this.info(`RFPA viewed successfully with ID: ${rfpaId}`, user);
    }
  }

  static logDeliveryChallanCreated(challanId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`Delivery Challan created successfully with ID: ${challanId}`, user, ip);
    } else {
      this.info(`Delivery Challan created successfully with ID: ${challanId}`, user);
    }
  }

  static logDeliveryChallanUpdated(challanId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`Delivery Challan updated successfully with ID: ${challanId}`, user, ip);
    } else {
      this.info(`Delivery Challan updated successfully with ID: ${challanId}`, user);
    }
  }

  static logGrnCreated(grnId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`GRN created successfully with ID: ${grnId}`, user, ip);
    } else {
      this.info(`GRN created successfully with ID: ${grnId}`, user);
    }
  }

  static logGrnUpdated(grnId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`GRN updated successfully with ID: ${grnId}`, user, ip);
    } else {
      this.info(`GRN updated successfully with ID: ${grnId}`, user);
    }
  }

  static logInvoiceCreated(invoiceId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`Invoice created successfully with ID: ${invoiceId}`, user, ip);
    } else {
      this.info(`Invoice created successfully with ID: ${invoiceId}`, user);
    }
  }

  static logInvoiceUpdated(invoiceId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`Invoice updated successfully with ID: ${invoiceId}`, user, ip);
    } else {
      this.info(`Invoice updated successfully with ID: ${invoiceId}`, user);
    }
  }

  static logEodStockCreated(eodId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`EOD Stock created successfully with ID: ${eodId}`, user, ip);
    } else {
      this.info(`EOD Stock created successfully with ID: ${eodId}`, user);
    }
  }

  static logEodStockUpdated(eodId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`EOD Stock updated successfully with ID: ${eodId}`, user, ip);
    } else {
      this.info(`EOD Stock updated successfully with ID: ${eodId}`, user);
    }
  }

  static logUserLogin(user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`User logged in successfully`, user, ip);
    } else {
      this.info(`User logged in successfully`, user);
    }
  }

  static logUserLogout(user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`User logged out successfully`, user, ip);
    } else {
      this.info(`User logged out successfully`, user);
    }
  }

  static logDataExport(exportType: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`${exportType} data exported successfully`, user, ip);
    } else {
      this.info(`${exportType} data exported successfully`, user);
    }
  }

  static logReportGenerated(reportType: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`${reportType} report generated successfully`, user, ip);
    } else {
      this.info(`${reportType} report generated successfully`, user);
    }
  }

  static logApprovalAction(action: string, documentType: string, documentId: string, user?: any, ip?: string) {
    if (ip) {
      this.infoWithIp(`${documentType} ${action} successfully for ID: ${documentId}`, user, ip);
    } else {
      this.info(`${documentType} ${action} successfully for ID: ${documentId}`, user);
    }
  }
}

export default logger;
