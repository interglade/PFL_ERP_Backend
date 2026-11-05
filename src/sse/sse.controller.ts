import { inject } from 'inversify';
import {
  controller,
  httpGet,
  request,
  response,
  next,
} from 'inversify-express-utils';
import { Request, Response, NextFunction } from 'express';
import { TYPES } from '../types';
import { SSEService } from './sse.service';
import logger from '../utils/logger';
import { getUserIdFromToken } from '../utils/helperSSE';

@controller('/sse')
export class SSEController {
  constructor(
    @inject(TYPES.SSEService) private sseService: SSEService
  ) {}

  /**
   * SSE endpoint for notifications
   * GET /sse/notifications
   */
  @httpGet('/notifications')
public streamNotifications(
  @request() req: Request,
  @response() res: Response
) {
  const token = req.query.token as string;

  if (!token) {
    res.write(`event: error\ndata: Token missing\n\n`);
    return res.end();
  }

  const userId = getUserIdFromToken(token);
  if (!userId) {
    logger.warn(`SSE unauthorized - token verification failed`);
    res.write(`event: error\ndata: Unauthorized\n\n`);
    return res.end();
  }

  const clientId = `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  logger.info(`SSE connected: ${userId} (${clientId})`);

  this.sseService.addClient(userId, clientId, res);

  const heartbeat: NodeJS.Timeout = setInterval(() => {
    if (res.writableEnded) return clearInterval(heartbeat);
    this.sseService.sendHeartbeat();
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    this.sseService.removeClient(userId, clientId);
    logger.info(`SSE closed: ${userId} (${clientId})`);
  });
}

}


  // /**
  //  * Get SSE connection status
  //  * GET /sse/status
  //  */
  // @httpGet('/status')
  // public async getStatus(
  //   @request() req: Request,
  //   @response() res: Response,
  //   @next() next: NextFunction
  // ) {
  //   try {
  //     const userId = res.locals.user?.id;
      
  //     const status = {
  //       totalConnections: this.sseService.getActiveConnectionsCount(),
  //       activeUsers: this.sseService.getActiveUsers().length,
  //       userConnected: userId ? this.sseService.isUserConnected(userId) : false,
  //     };

  //     res.status(200).json({
  //       status: 'success',
  //       data: status,
  //     });
  //   } catch (error) {
  //     logger.error('Error getting SSE status:', error);
  //     next(error);
  //   }
  // }

