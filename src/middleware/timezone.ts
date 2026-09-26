import { classToPlain, instanceToPlain } from 'class-transformer';
import { NextFunction,Request,Response } from 'express';
import moment from 'moment-timezone';
import { BaseEntity } from 'typeorm';
import Model from '../global/model.entity';

export const timezoneMiddleware = (req:Request, res:Response, next:NextFunction) => {
  const oldJson = res.json;

  res.json = function (data) {
    if (data && typeof data === 'object') {
      convertDatesToIST(data);
    }
    return oldJson.call(this, data);
  };

  next();
};

interface AnyObject {
    [key: string]: any;
}

// function convertDatesToIST(obj: AnyObject): void {
//     for (const key in obj) {
//         if (obj[key] instanceof Date) {
//             obj[key] = moment(obj[key]).tz('Asia/Kolkata').format('DD-MM-YYYY HH:mm:ss');
//         } else if (typeof obj[key] === 'object' && obj[key] !== null) {
//             convertDatesToIST(obj[key]);
//         }
//     }
// }
function convertDatesToIST(obj: AnyObject, seen = new WeakSet()): void {
  if (seen.has(obj)) return; // Prevent infinite loops
  seen.add(obj);

  for (const key in obj) {
      if (obj[key] instanceof Date) {
          obj[key] = moment(obj[key]).tz('Asia/Kolkata').format('DD-MM-YYYY hh:mm A');
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          convertDatesToIST(obj[key], seen);
      }
  }
}

export class TransformResponseMiddleware {
  static transform(req: Request, res: Response, next: NextFunction) {
    const oldJson = res.json;

    res.json = function (data: any) {
      if (data && typeof data === "object") {
        if (data instanceof BaseEntity || (Array.isArray(data) && data[0] instanceof BaseEntity)) {
          const transformed = classToPlain(data, { excludeExtraneousValues: true });
          return oldJson.call(this, transformed);
        }
      }
      return oldJson.call(this, data);
    };

    next();
  }
}
