import { verifyJwt } from './jwt';
import logger from './logger';

export function getUserIdFromToken(token: string): string | null {
  try {
    const decoded = verifyJwt<{ sub: string }>(token, 'accessTokenPublicKey');
    if (!decoded) {
      logger.warn('SSE token verification returned null');
      return null;
    }
    return decoded.sub || null;
  } catch (err) {
    logger.error('SSE token verification error:', err);
    return null;
  }
}
