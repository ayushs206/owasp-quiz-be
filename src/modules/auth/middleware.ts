/* eslint-disable @typescript-eslint/no-namespace */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { JwksFetcher } from '../../lib/supabase.js';
import type { Env } from '../../shared/config/env.js';
import { ProblemError } from '../../shared/errors/problem.js';
import { verifyAuthToken, type AuthenticatedIdentity } from './service.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedIdentity;
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
