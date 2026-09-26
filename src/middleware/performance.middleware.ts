import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';

// Performance monitoring middleware
export const performanceMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function(this: typeof res, chunk?: any, encoding?: BufferEncoding, cb?: () => void) {
    const duration = Date.now() - startTime;
    
    // Log slow queries (> 1 second)
    if (duration > 1000) {
      logger.warn(`Slow API call: ${req.method} ${req.originalUrl} - ${duration}ms`);
    }
    
    // Add performance headers
    res.setHeader('X-Response-Time', `${duration}ms`);
    
    return originalEnd.call(this, chunk, encoding as BufferEncoding, cb);
  } as typeof res.end;
  
  next();
};

// Smart rate limiting based on endpoint type
export const createSmartRateLimit = (windowMs: number = 15 * 60 * 1000, max: number = 100) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Using default in-memory store — reliable and no external dependency issues
  });
};

// Different rate limits for different endpoint types
export const authRateLimit = createSmartRateLimit(15 * 60 * 1000, 5); // 5 requests per 15 minutes for auth
export const apiRateLimit = createSmartRateLimit(15 * 60 * 1000, 1000); // 1000 requests per 15 minutes for API
export const uploadRateLimit = createSmartRateLimit(60 * 60 * 1000, 50); // 50 uploads per hour