import os from 'os';
import useragent from 'useragent';
import { Request, Response, NextFunction } from 'express';

export function captureUserInfo(req: Request, res: Response, next: NextFunction) {
  const agent = useragent.parse(req.headers['user-agent'] || '');

  const systemInfo = {
    ip: req.ip || req.socket.remoteAddress || '', 
    osPlatform: os.platform(),
    osRelease: os.release(),
    osType: os.type(),
    cpuArch: os.arch(),
    browser: agent.toAgent(),
    device: agent.device.toString(),
    osName: agent.os.toString(),
    time: new Date().toISOString(),
  };

  req.systemInfo = systemInfo;
  next();
}


declare global {
    namespace Express {
      export interface Request {
        systemInfo?: {
          ip: string;
          osPlatform: string;
          osRelease: string;
          osType: string;
          cpuArch: string;
          browser: string;
          device: string;
          osName: string;
          time: string;
        };
      }
    }
  }