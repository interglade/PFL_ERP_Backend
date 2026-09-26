import { Request, Response, NextFunction } from 'express';

import  logger  from '../utils/logger';

interface CustomRequest extends Request {
  clientIp?: string;
}

export const logRequestMiddleware = (req: CustomRequest, res: Response, next: NextFunction) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip;
    req.clientIp = clientIp as string;
    
 

  logger.info(`Received ${req.method} request on ${req.originalUrl}`, { ip: clientIp });
  next();
};