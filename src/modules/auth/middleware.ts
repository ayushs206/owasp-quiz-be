/* eslint-disable @typescript-eslint/no-namespace */
import type { PrismaClient } from '@prisma/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { JwksFetcher } from '../../lib/supabase.js';
import type { Env } from '../../shared/config/env.js';
import { ProblemError } from '../../shared/errors/problem.js';
import { getCurrentProfile, type ProfileResponse } from '../users/service.js';
import { verifyAuthToken, type AuthenticatedIdentity } from './service.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedIdentity;
      profile?: ProfileResponse;
    }
  }
}

export function createAuthMiddleware(env: Env, customJwks?: JwksFetcher): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || typeof authHeader !== 'string') {
        throw new ProblemError({
          type: 'https://quiz.example/problems/unauthorized',
          title: 'Unauthorized',
          status: 401,
          code: 'UNAUTHORIZED',
          detail: 'Missing or malformed authorization header.',
        });
      }

      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      const token = match?.[1]?.trim();
      if (!token) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/unauthorized',
          title: 'Unauthorized',
          status: 401,
          code: 'UNAUTHORIZED',
          detail: 'Missing or malformed authorization header.',
        });
      }

      const identity = await verifyAuthToken(token, env, customJwks);
      req.user = identity;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createRequireActiveProfile(customDb?: PrismaClient): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new ProblemError({
          type: 'https://quiz.example/problems/unauthorized',
          title: 'Unauthorized',
          status: 401,
          code: 'UNAUTHORIZED',
          detail: 'Authentication token missing or invalid.',
        });
      }

      const profile = await getCurrentProfile(req.user.sub, req.user.email, customDb);
      req.profile = profile;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAdminRole(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (!req.profile) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        code: 'UNAUTHORIZED',
        detail: 'User profile not loaded.',
      });
    }

    if (req.profile.role !== 'ADMIN') {
      throw new ProblemError({
        type: 'https://quiz.example/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        code: 'FORBIDDEN',
        detail: 'Administrative access required.',
      });
    }

    if (req.profile.onboardingStatus !== 'COMPLETED') {
      throw new ProblemError({
        type: 'https://quiz.example/problems/profile-incomplete',
        title: 'Profile incomplete',
        status: 403,
        code: 'PROFILE_INCOMPLETE',
        detail: 'Complete onboarding before accessing administrative operations.',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
