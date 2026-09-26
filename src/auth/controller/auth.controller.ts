import { Request, Response, NextFunction, CookieOptions } from 'express';
import config from 'config';
import bcrypt from 'bcryptjs';

import AppError from '../../utils/appError';
import { signJwt, verifyJwt } from '../../utils/jwt';
import { inject } from 'inversify';
import { controller, httpPost, request, response, next } from 'inversify-express-utils';
import { TYPES } from '../../types';
import logger from '../../utils/logger';
import { ControllerLogger } from '../../utils/controllerLogger';
import { UserSystemInfoRepository } from '../../employeeSystemInfo/repository/userSystemInfo.repository';
import { AppDataSource } from '../../utils/data-source';
import { BlacklistedToken } from '../entity/blacklistedToken.entity';

import { SSEService } from '../../sse/sse.service';
import { UserRepository } from '../../employee/repository/user.repository';

import { CacheService } from '../../global/cache.service';

import { UserActivityLogService } from '../../employeeActivity/service/userActivityLog.service';

import { WorkflowHierarchyRepository } from '../../workFlow/repository/WorkflowHierarchy.repository';
import { MoreThan } from 'typeorm';
import { UserService } from '../../employee/service/user.service';
import { ActiveSessionRepository } from '../repository/activeSession.repository';
import { NotificationService } from '../../notification/service/notification.service';
import { WorkflowHierarchyService } from '../../workFlow/service/workFlowHierarchy.service';
import { ActivityAction, ActivityModule } from '../../employeeActivity/entity/userActivityLog.entity';


const blacklistedTokensRepo = AppDataSource.getRepository(BlacklistedToken);

const cookiesOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/',
  secure: true, // Always use secure cookies — HTTP-only environments should use HTTPS
};

const accessTokenCookieOptions: CookieOptions = {
  ...cookiesOptions,
  expires: new Date(Date.now() + config.get<number>('accessTokenExpiresIn') * 60 * 1000),
  maxAge: config.get<number>('accessTokenExpiresIn') * 60 * 1000,
};

const refreshTokenCookieOptions: CookieOptions = {
  ...cookiesOptions,
  expires: new Date(Date.now() + config.get<number>('refreshTokenExpiresIn') * 60 * 1000),
  maxAge: config.get<number>('refreshTokenExpiresIn') * 60 * 1000,
};

// Cache TTLs
const USER_CACHE_TTL = 300;        // 5 min — user data for login/refresh
const BLACKLIST_CACHE_TTL = 3600;  // 1 hour — blacklisted tokens

@controller('/auth')
export class AuthController {
  constructor(
    @inject(TYPES.UserService) private userService: UserService,
    @inject(TYPES.ActiveSessionRepository)
    private activeSessionRepository: ActiveSessionRepository,
    @inject(TYPES.UserSystemInfoRepository)
    private readonly systemLogRepository: UserSystemInfoRepository,
    @inject(TYPES.NotificationService)
    private notificationService: NotificationService,
    @inject(TYPES.SSEService)
    private sseService: SSEService,
    @inject(TYPES.UserRepository)
    private userRepository: UserRepository,
     @inject(TYPES.WorkflowHierarchyRepository)
    private workflowrepo:WorkflowHierarchyRepository,
    @inject(TYPES.CacheService)
    private cacheService: CacheService,
    @inject(TYPES.WorkflowHierarchyService)
    private workflowHierarchyService: WorkflowHierarchyService,
    @inject(TYPES.UserActivityLogService)
    private activityLogService: UserActivityLogService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private blacklistCacheKey(token: string): string {
    // SHA256 hash of full token — avoids truncation collisions
    return `auth:blacklist:${require('crypto').createHash('sha256').update(token).digest('hex')}`;
  }

  private userCacheKey(uid: string): string {
    return `auth:user:${uid}`;
  }

  private async isTokenBlacklisted(token: string): Promise<boolean> {
    // Check Redis first
    const key = this.blacklistCacheKey(token);
    const cached = await this.cacheService.get<boolean>(key);
    if (cached !== null) return cached;

    // Fall back to DB
    const found = await blacklistedTokensRepo.findOne({ where: { token } });
    const result = !!found;

    // Cache the result
    await this.cacheService.set(key, result, BLACKLIST_CACHE_TTL);
    return result;
  }

  private async blacklistToken(token: string, expiresAt: Date): Promise<void> {
    const entity = new BlacklistedToken();
    entity.token = token;
    entity.createdAt = new Date();
    entity.expiresAt = expiresAt;
    await blacklistedTokensRepo.save(entity);

    // Cache as blacklisted immediately
    await this.cacheService.set(this.blacklistCacheKey(token), true, BLACKLIST_CACHE_TTL);
  }

  // ─── Refresh Token ────────────────────────────────────────────────────────

  @httpPost('/refresh-token')
  public async refreshAccessTokenHandler(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const refresh_token = req.body.refreshToken;
      console.log('[refresh-token] token present:', !!refresh_token);
      if (!refresh_token) {
        console.log('[refresh-token] FAIL: no token in body');
        return next(new AppError(403, 'You need to re-authenticate. Please log in.'));
      }

      // Fast blacklist check via Redis
      const isBlacklisted = await this.isTokenBlacklisted(refresh_token);
      console.log('[refresh-token] isBlacklisted:', isBlacklisted);
      if (isBlacklisted) {
        logger.warn(`Blacklisted refresh token used from IP: ${req.ip}`);
        return next(new AppError(401, 'You need to re-authenticate. Please log in.'));
      }

      const decoded = verifyJwt<{ sub: string }>(refresh_token, 'refreshTokenPublicKey');
      console.log('[refresh-token] decoded:', decoded ? `userId=${decoded.sub}` : 'NULL - invalid/expired');
      if (!decoded) {
        logger.warn(`Invalid refresh token from IP: ${req.ip}`);
        return next(new AppError(403, 'You need to re-authenticate. Please log in.'));
      }

      // Try cache first for user lookup
      const userCacheKey = this.userCacheKey(decoded.sub);
      let user = await this.cacheService.get<any>(userCacheKey);
      if (!user) {
        user = await this.userService.findUserById(decoded.sub);
        if (user) await this.cacheService.set(userCacheKey, user, USER_CACHE_TTL);
      }

      if (!user) {
        logger.warn(`Refresh token for non-existent user from IP: ${req.ip}`);
        return next(new AppError(403, 'You need to re-authenticate. Please log in.'));
      }

      const access_token = signJwt({ sub: user.id }, 'accessTokenPrivateKey', {
        expiresIn: `${config.get<number>('accessTokenExpiresIn')}m`,
      });

      res.cookie('access_token', access_token, accessTokenCookieOptions);
      res.cookie('logged_in', true, { ...accessTokenCookieOptions, httpOnly: false });

      logger.info('Access token refreshed successfully', { userId: user.id });
      res.status(200).json({ status: 'success', access_token });
    } catch (err: any) {
      logger.error('Error while refreshing access token', { error: err.message });
      next(err);
    }
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  @httpPost('/login')
  public async loginUserHandler(
    @request() req: Request<{}, {}, any>,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const { uid, password } = req.body;

      if (!uid || !password) {
        throw new AppError(400, 'UID and Password are required.');
      }

      const trimmedPassword = password.trim();

      // Try cache first — avoids heavy DB join on repeated login attempts
      const userCacheKey = this.userCacheKey(uid);
      let user = await this.cacheService.get<any>(userCacheKey);
      if (!user) {
        user = await this.userService.findUserByIdentifier(uid);
        if (user) await this.cacheService.set(userCacheKey, user, USER_CACHE_TTL);
      }

      if (!user) {
        logger.warn(`Failed login for non-existent user: ${uid} from IP: ${req.ip}`);
        throw new AppError(404, 'Username or email is incorrect');
      }

      if (user.status === 'INACTIVE') {
        throw new AppError(403, 'Your account is inactive. Please contact administrator.');
      }

     // const isPasswordMatch = user.tempPlainPassword === trimmedPassword;
// ✅ Fix
const isPasswordMatch = await bcrypt.compare(trimmedPassword, user.password);
      // Mark online — invalidate cache so fresh data is fetched next time
      user.isOnline = true;
      await this.userRepository.save(user);
      await this.cacheService.del(userCacheKey);

      if (!isPasswordMatch) {
        ControllerLogger.logAuth('User login', req, res, false);
        throw new AppError(401, 'Wrong password');
      }

      const permissions = user.permissions.map((permission: any) => ({
        documentDefinition: permission.documentDefinition
          ? {
              id: permission.documentDefinition.id,
              name: permission.documentDefinition.name,
              uniqueKey: permission.documentDefinition.uniqueKey,
            }
          : null,
        canCreate: permission.canCreate,
        canView: permission.canView,
        canEdit: permission.canEdit,
        canDelete: permission.canDelete,
        canDownload: permission.canDownload,
      }));

      const name = `${user.firstName} ${user.lastName}`;

      // Store active session if none exists
      const existingSessions = await this.activeSessionRepository.find({
        where: { user_id: user.id, is_active: true },
      });

      if (!existingSessions || existingSessions.length === 0) {
        const session = this.activeSessionRepository.create({
          user_id: user.id,
          username: name,
          is_active: true,
        });
        await this.activeSessionRepository.save(session);
        logger.info('Active session stored', { userId: user.id });
      }

      // Save system info log
      const { ip, osPlatform, osRelease, osType, cpuArch, browser, device, osName } = req.systemInfo ?? {};
      const systemLog = this.systemLogRepository.create({
        userId: user.id, ip, osPlatform, osRelease, osType, cpuArch, browser, device, osName,
      });
      await this.systemLogRepository.save(systemLog);

      const { access_token, refresh_token } = await this.userService.signTokens(user);

      res.cookie('access_token', access_token, accessTokenCookieOptions);
      res.cookie('refresh_token', refresh_token, refreshTokenCookieOptions);
      res.cookie('logged_in', true, { ...accessTokenCookieOptions, httpOnly: false });

      this.notificationService.createNoti('Login successfully', user.id).catch(() => {});
      const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown User';
      // Log login activity (fire-and-forget) - skip for admin role
      const isAdmin = user.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
      if (!isAdmin) {
        this.activityLogService.logActivity({
          userId: user.id,
          userName,
          action: ActivityAction.LOGIN,
          module: ActivityModule.OTHER,
          description: `${name} has logged in`,
          ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || 'unknown',
          userAgent: req.get('user-agent'),
          endpoint: req.originalUrl,
          httpMethod: req.method,
          statusCode: 200,
        }).catch(() => {});
      }

      // // Fetch the logged-in user's children tree across all departments
      // const workflowTree = await this.workflowHierarchyService.getChildrenTreeForAllDepartments(user.id);
      //  const hasWorkflow = workflowTree > 0;

      // Check if the user has any subordinates in the workflow hierarchy (depth > 0 means actual children)
      const workflowCount = await this.workflowrepo.count({
        where: {
          ancestor: { id: user.id },
          depth: MoreThan(0),
          isDeleted: false,
        },
      });
      const hasChild = workflowCount > 0;

      ControllerLogger.logAuth('User login', req, res, true);
      logger.info('User logged in successfully', { userId: user.id });

      // refresh_token is already in httpOnly cookie — do NOT send in body (XSS risk)
      res.status(200).json({
        status: 'success',
        access_token,
        refresh_token,
        id: user.id,
        userName: name,
        roles: user.roles,
        currentWorkLocation: user.currentWorkLocation?.id,
        employeeId: user.employeeId,
        permissions,
        hasChild,
      });
    } catch (err) {
      logger.error('Unexpected error during login', { error: err });
      next(err);
    }
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  @httpPost('/logout')
  public async logoutUserHandler(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { refresh_token, access_token } = req.body;

      if (!refresh_token) return next(new AppError(400, 'Refresh token not provided'));
      if (!access_token) return next(new AppError(400, 'Access token not provided'));

      const decoded = verifyJwt<{ sub: string }>(access_token, 'accessTokenPublicKey');
      const user = decoded?.sub
        ? await this.userRepository.findOne({ where: { id: decoded.sub } })
        : null;

      if (user) {
        user.isOnline = false;
        await this.userRepository.save(user);
        // Invalidate user cache on logout
        await this.cacheService.del(this.userCacheKey(user.id));
      }

      // Blacklist both tokens (DB + Redis cache)
      const accessExpiry = new Date((Math.floor(Date.now() / 1000) + config.get<number>('accessTokenExpiresIn') * 60) * 1000);
      const refreshExpiry = new Date((Math.floor(Date.now() / 1000) + config.get<number>('refreshTokenExpiresIn') * 60) * 1000);

      await Promise.all([
        this.blacklistToken(access_token, accessExpiry),
        this.blacklistToken(refresh_token, refreshExpiry),
      ]);

      // Remove active session
      if (decoded?.sub) {
        await this.activeSessionRepository.delete({ user_id: decoded.sub, is_active: true });
      }

      // Log logout activity (fire-and-forget) - skip for admin role
      if (user) {
        const isAdmin = user.roles?.some((role: any) => role.name?.toLowerCase() === 'admin');
        if (!isAdmin) {
          //const userName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
          const userName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || (user as any).username || 'Unknown User';
          this.activityLogService.logActivity({
            userId: user.id,
            userName,
            action: ActivityAction.LOGOUT,
            module: ActivityModule.OTHER,
            description: `${userName} has logged out`,
            ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || 'unknown',
            userAgent: req.get('user-agent'),
            endpoint: req.originalUrl,
            httpMethod: req.method,
            statusCode: 200,
          }).catch(() => {});
        }
      }

      res.clearCookie('access_token');
      res.clearCookie('refresh_token');

      // SSE logout notification (fire-and-forget)
      if (user && this.sseService.isUserConnected(user.id)) {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        let hours = now.getHours();
        const minutes = pad(now.getMinutes());
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        this.sseService.sendToUser(user.id, {
          type: 'notification',
          message: 'Logout successfully',
          date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
          time: `${pad(hours)}:${minutes} ${ampm}`,
          isRead: false,
          userId: user.id,
          timestamp: now.toISOString(),
        });
      }

      ControllerLogger.logAuth('User logout', req, res, true);
      logger.info('User logged out successfully');

      res.status(200).json({ status: 'success', message: 'User logged out successfully' });
    } catch (error) {
      next(error);
    }
  }
}
