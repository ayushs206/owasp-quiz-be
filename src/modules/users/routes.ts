import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';

import type { JwksFetcher } from '../../lib/supabase.js';
import type { Env } from '../../shared/config/env.js';
import {
  createAuthMiddleware,
  createRequireActiveProfile,
  requireAdminRole,
} from '../auth/middleware.js';
import {
  adminListUsersQuerySchema,
  adminUserUpdateRequestSchema,
  onboardingRequestSchema,
  userIdParamSchema,
} from './schema.js';
import {
  adminGetUser,
  adminListUsers,
  adminUpdateUser,
  completeOnboarding,
  getCurrentProfile,
} from './service.js';

export function createUserRouter(
  env: Env,
  customJwks?: JwksFetcher,
  customDb?: PrismaClient,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(env, customJwks);
  const requireActiveProfile = createRequireActiveProfile(customDb);

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

  router.get(
    '/admin/users',
    authMiddleware,
    requireActiveProfile,
    requireAdminRole,
    async (req, res, next) => {
      try {
        const query = adminListUsersQuerySchema.parse(req.query);
        const result = await adminListUsers(query, customDb);
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/users/:userId',
    authMiddleware,
    requireActiveProfile,
    requireAdminRole,
    async (req, res, next) => {
      try {
        const { userId } = userIdParamSchema.parse(req.params);
        const profile = await adminGetUser(userId, customDb);
        res.json(profile);
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/admin/users/:userId',
    authMiddleware,
    requireActiveProfile,
    requireAdminRole,
    async (req, res, next) => {
      try {
        const { userId } = userIdParamSchema.parse(req.params);
        const input = adminUserUpdateRequestSchema.parse(req.body);
        const actorId = req.profile!.id;
        const reqId = typeof req.id === 'string' ? req.id : undefined;
        const updateInput: {
          fullName?: string;
          rollNumber?: string;
          branchCode?: string;
          phoneNumber?: string;
          role?: 'STUDENT' | 'ADMIN';
          status?: 'ACTIVE' | 'BLOCKED';
        } = {};
        if (input.fullName !== undefined) updateInput.fullName = input.fullName;
        if (input.rollNumber !== undefined) updateInput.rollNumber = input.rollNumber;
        if (input.branchCode !== undefined) updateInput.branchCode = input.branchCode;
        if (input.phoneNumber !== undefined) updateInput.phoneNumber = input.phoneNumber;
        if (input.role !== undefined) updateInput.role = input.role;
        if (input.status !== undefined) updateInput.status = input.status;

        const profile = await adminUpdateUser(
          actorId,
          userId,
          updateInput,
          reqId,
          req.log,
          customDb,
        );
        res.json(profile);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
