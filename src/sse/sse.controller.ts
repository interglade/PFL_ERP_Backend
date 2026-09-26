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




  /**
   * Test SSE endpoint - Simple test without full auth
   * GET /sse/test
   */
  @httpGet('/test')
  public testSSE(
    @request() req: Request,
    @response() res: Response
  ) {
    try {
      logger.info('SSE test endpoint called');

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // Send initial message
      res.write(`data: ${JSON.stringify({ 
        type: 'test', 
        message: 'SSE test connection successful!',
        timestamp: new Date().toISOString()
      })}\n\n`);

      // Send a few test messages
      let count = 0;
      const interval = setInterval(() => {
        count++;
        res.write(`data: ${JSON.stringify({ 
          type: 'test', 
          message: `Test message ${count}`,
          timestamp: new Date().toISOString()
        })}\n\n`);

        if (count >= 5) {
          clearInterval(interval);
          res.write(`data: ${JSON.stringify({ 
            type: 'test', 
            message: 'Test complete! Connection will stay open.',
            timestamp: new Date().toISOString()
          })}\n\n`);
        }
      }, 2000);

      // Clean up on close
      req.on('close', () => {
        clearInterval(interval);
        logger.info('SSE test connection closed');
      });

    } catch (error) {
      logger.error('Error in SSE test:', error);
      res.status(500).json({ error: 'SSE test failed' });
    }
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

