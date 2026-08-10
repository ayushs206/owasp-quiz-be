import { randomUUID } from 'node:crypto';

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import type { PrismaClient } from '@prisma/client';

import type { JwksFetcher } from './lib/supabase.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { createHealthRouter, type ReadinessCheck } from './modules/health/routes.js';
import { createUserRouter } from './modules/users/routes.js';
import type { Env } from './shared/config/env.js';
import { createCorsOptions } from './shared/security/cors.js';
import { createGeneralRateLimit } from './shared/security/rate-limit.js';

export interface AppDependencies {
  env: Env;
  logger: Logger;
  readinessCheck: ReadinessCheck;
  customJwks?: JwksFetcher | undefined;
  customDb?: PrismaClient | undefined;
}

export function createApp(dependencies: AppDependencies): Express {
  const { env, logger, readinessCheck, customJwks, customDb } = dependencies;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId(req): string {
        const value = req.headers['x-request-id'];
        return typeof value === 'string' ? value : randomUUID();
      },
    }),
  );
  app.use(helmet());
  app.use(cors(createCorsOptions(env.CORS_ORIGINS)));
  app.use(createGeneralRateLimit());
  app.use(express.json({ limit: '32kb' }));

  app.use('/health', createHealthRouter(readinessCheck));
  app.use('/v1', createUserRouter(env, customJwks, customDb));

  app.use(notFound);
  app.use(createErrorHandler(logger));

  return app;
}
