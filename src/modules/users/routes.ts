import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';

import type { JwksFetcher } from '../../lib/supabase.js';
import type { Env } from '../../shared/config/env.js';
import { createAuthMiddleware } from '../auth/middleware.js';
import { onboardingRequestSchema } from './schema.js';
import { completeOnboarding, getCurrentProfile } from './service.js';

export function createUserRouter(
  env: Env,
  customJwks?: JwksFetcher,
  customDb?: PrismaClient,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(env, customJwks);

  router.get('/me', authMiddleware, async (req, res, next) => {
    try {
      const user = req.user!;
      const profile = await getCurrentProfile(user.sub, user.email, customDb);
      res.json(profile);
    } catch (error) {
      next(error);
    }
  });

  router.post('/onboarding', authMiddleware, async (req, res, next) => {
    try {
      const user = req.user!;
      const input = onboardingRequestSchema.parse(req.body);
      const { profile, created } = await completeOnboarding(user.sub, user.email, input, customDb);
      res.status(created ? 201 : 200).json(profile);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
