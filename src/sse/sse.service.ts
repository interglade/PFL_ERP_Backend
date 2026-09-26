import { injectable } from 'inversify';
import { Response } from 'express';
import logger from '../utils/logger';

interface SSEClient {
  id: string;
  userId: string;
  response: Response;
  lastEventId?: string;
}

@injectable()
export class SSEService {
  private clients: Map<string, SSEClient[]> = new Map();
  private messageBuffer: Map<string, any[]> = new Map(); // Buffer for batch sending
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 10; // Batch size
  private readonly FLUSH_INTERVAL = 100; // ms

  constructor() {
    // Start periodic flush of buffered messages
    this.startBufferFlush();
  }

  private startBufferFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flushBuffers();
    }, this.FLUSH_INTERVAL);
  }

  private flushBuffers(): void {
    this.messageBuffer.forEach((messages, userId) => {
      if (messages.length > 0) {
        const userClients = this.clients.get(userId);
        if (userClients && userClients.length > 0) {
          // Send all buffered messages at once
          userClients.forEach(client => {
            messages.forEach(data => {
              this.sendToClient(client.response, data);
            });
          });
          this.messageBuffer.set(userId, []);
        }
      }
    });
  }

  /**
   * Add a new SSE client connection
   */
  addClient(userId: string, clientId: string, res: Response): void {
    // Close and evict all existing connections for this user before adding the new one.
    // This prevents stale tabs / React-StrictMode double-mounts from accumulating
    // connections that each receive a copy of every subsequent notification.
    const existingClients = this.clients.get(userId);
    if (existingClients && existingClients.length > 0) {
      existingClients.forEach(client => {
        try { client.response.end(); } catch (_) {}
      });
      this.clients.delete(userId);
      this.messageBuffer.delete(userId);
      logger.info(`SSE evicted ${existingClients.length} stale connection(s) for user: ${userId}`);
    }

    this.clients.set(userId, [{
      id: clientId,
      userId,
      response: res,
    }]);

    logger.info(`SSE client connected: ${clientId} for user: ${userId}`);

    // Send initial connection message
    this.sendToClient(res, {
      type: 'connected',
      message: 'Connected to notification stream',
      timestamp: new Date().toISOString(),
    });

    // Handle client disconnect
    res.on('close', () => {
      this.removeClient(userId, clientId);
      logger.info(`SSE client disconnected: ${clientId} for user: ${userId}`);
    });
  }

  /**
   * Remove a client connection
   */
  removeClient(userId: string, clientId: string): void {
    const userClients = this.clients.get(userId);
    if (userClients) {
      const filteredClients = userClients.filter(client => client.id !== clientId);
      
      if (filteredClients.length === 0) {
        this.clients.delete(userId);
        this.messageBuffer.delete(userId); // Clean up buffer too
      } else {
        this.clients.set(userId, filteredClients);
      }
    }
  }

  /**
   * Send notification to specific user (with buffering)
   */
  sendToUser(userId: string, data: any): void {
    const userClients = this.clients.get(userId);
    
    if (!userClients || userClients.length === 0) {
      logger.warn(`No active SSE clients for user: ${userId}`);
      return;
    }

    // Buffer the message
    if (!this.messageBuffer.has(userId)) {
      this.messageBuffer.set(userId, []);
    }
    
    const buffer = this.messageBuffer.get(userId)!;
    buffer.push(data);

    // If buffer is full, flush immediately
    if (buffer.length >= this.BUFFER_SIZE) {
      userClients.forEach(client => {
        buffer.forEach(msg => {
          this.sendToClient(client.response, msg);
        });
      });
      this.messageBuffer.set(userId, []);
    }
  }

  /**
   * Send notification to multiple users (optimized batch)
   */
  sendToUsers(userIds: string[], data: any): void {
    // Buffer all messages first
    userIds.forEach(userId => {
      if (!this.messageBuffer.has(userId)) {
        this.messageBuffer.set(userId, []);
      }
      this.messageBuffer.get(userId)!.push(data);
    });

    // Flush immediately for batch operations
    this.flushBuffers();
  }

  /**
   * Broadcast to all connected clients (optimized)
   */
  broadcast(data: any): void {
    let sentCount = 0;
    
    // Collect all responses first
    const allResponses: Response[] = [];
    this.clients.forEach((userClients) => {
      userClients.forEach(client => {
        allResponses.push(client.response);
      });
    });

    // Send to all at once
    allResponses.forEach(res => {
      try {
        this.sendToClient(res, data);
        sentCount++;
      } catch (error) {
        logger.error('Error broadcasting to client:', error);
      }
    });
    
    logger.info(`Broadcast sent to ${sentCount} clients`);
  }

  /**
   * Send data to a specific client response (optimized)
   */
  private sendToClient(res: Response, data: any): void {
    try {
      const eventData = {
        ...data,
        timestamp: data.timestamp || new Date().toISOString(),
      };
      
      // Use write with callback for better error handling
      const message = `data: ${JSON.stringify(eventData)}\n\n`;
      
      res.write(message, (err) => {
        if (err) {
          logger.error('Error writing SSE message:', err);
        }
      });

      // Force flush — required with compression middleware
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    } catch (error) {
      logger.error('Error sending SSE message:', error);
    }
  }

  /**
   * Send heartbeat to keep connection alive (optimized)
   */
  sendHeartbeat(): void {
    const heartbeatMessage = ': heartbeat\n\n';
    let sentCount = 0;

    this.clients.forEach((userClients) => {
      userClients.forEach(client => {
        try {
          client.response.write(heartbeatMessage, (err) => {
            if (err) {
              logger.error('Heartbeat write error:', err);
            }
          });
          
          if (typeof (client.response as any).flush === 'function') {
            (client.response as any).flush();
          }
          sentCount++;
        } catch (error) {
          logger.error('Error sending heartbeat:', error);
        }
      });
    });

    if (sentCount > 0) {
      logger.debug(`Heartbeat sent to ${sentCount} clients`);
    }
  }

  /**
   * Get count of active connections
   */
  getActiveConnectionsCount(): number {
    let count = 0;
    this.clients.forEach(userClients => {
      count += userClients.length;
    });
    return count;
  }

  /**
   * Get active users
   */
  getActiveUsers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if user has active connection
   */
  isUserConnected(userId: string): boolean {
    const userClients = this.clients.get(userId);
    return userClients !== undefined && userClients.length > 0;
  }

  /**
   * Cleanup resources (call on app shutdown)
   */
  cleanup(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.clients.clear();
    this.messageBuffer.clear();
  }
}
