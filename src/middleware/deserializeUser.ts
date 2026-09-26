import { NextFunction, Request, Response } from 'express';

import AppError from '../utils/appError';

import { verifyJwt } from '../utils/jwt';
import { AppDataSource } from '../utils/data-source';

import logger from '../utils/logger';
import { User } from '../employee/entity/user.entity';
import { BlacklistedToken } from '../auth/entity/blacklistedToken.entity';



const userrepo = AppDataSource.getRepository(User);
const blacklistedTokensRepo = AppDataSource.getRepository(BlacklistedToken);

export const deserializeUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    let access_token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      access_token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.access_token) {
      access_token = req.cookies.access_token;
    }

    if (!access_token) {
      return next(new AppError(401, 'You are not logged in'));
    }

    const decoded = verifyJwt<{ sub: string }>(
      access_token,
      'accessTokenPublicKey',
    );

    if (!decoded) {
      return next(
        new AppError(401, `You need to re-authenticate. Please log in.`),
      );
    }

    const blacklistedToken = await blacklistedTokensRepo.findOne({
      where: { token: access_token },
    });

    if (blacklistedToken) {
      return next(
        new AppError(401, 'You need to re-authenticate. Please log in.'),
      );
    }

    const user = await userrepo.findOne({ where: { id: decoded.sub } });

    if (!user) {
      return next(
        new AppError(401, `You need to re-authenticate. Please log in.`),
      );
    }

    res.locals.user = user;

    next();
  } catch (err: any) {
    logger.error('deserializeUser error:', { message: err?.message, stack: err?.stack });
    next(err);
  }
};

// // Middleware: Role Authorization
// export const roleAuthorization = (...roles: string[]) => {
//     return async (req: Request, res: Response, next: NextFunction) => {
//       const userId = res.locals.user.id;
//       const user = await User.findOne({ where: { id: userId }
//         //, relations: ['role']
//       });
//   //     if (!user || !user.role) {
//   //       return res.status(403).json({ message: 'Access denied: User not found or has no role.' });
//   //   }

//   //   if (!roles.includes(user.role.name)) {
//   //     return res.status(403).json({ message: 'Access denied: You do not have the required role.' });
//   // }
//       next();
//     };
//   };

export const requireUser = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const user = res.locals.user;

  if (!user) {
    return next(
      new AppError(400, `You need to re-authenticate. Please log in.`),
    );
  }

  next();
};

export async function captureUser(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // Retrieve user ID from res.locals, defaulting to 'System' if not available
    const userId = res.locals.user?.id;

    // Fetch user from the repository if not 'System'
    let user = null;
    if (userId !== 'System') {
      user = await userrepo.findOne({ where: { id: userId } });
    }

    // Capture system information (make sure req.systemInfo exists)
    let systemInfo = req.systemInfo; // Retrieve systemInfo from the request

    /// Capture the IP from systemInfo (default to 'Unknown' if not available)
    const ip = systemInfo?.ip;

    // Store the 'updatedBy' info (user or 'System')
    res.locals.updatedBy = user || 'System';

    // Store the user's username or 'Anonymous' if no user found
    //res.locals.user.username = { username: user?.firstName || 'Anonymous' };

    // Store the captured IP in res.locals for later use
    res.locals.ipAddress = ip;
    //console.log(res.locals.ipAddress);

    //console.log( res.locals.updatedBy.firstName,res.locals.updatedBy.lastName)
    // Continue to the next middleware or route handler
    next();
  } catch (error) {
    logger.error('Error capturing user info:', error);
    next(error);
  }
}
