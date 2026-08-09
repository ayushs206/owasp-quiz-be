import { createApp } from './app.js';
import { checkDatabaseReadiness, prisma } from './lib/prisma.js';
import { loadEnv } from './shared/config/env.js';
import { createLogger } from './shared/logging/logger.js';

const env = loadEnv();
const logger = createLogger(env);

const app = createApp({
  env,
  logger,
  readinessCheck: checkDatabaseReadiness,
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API listening');
});

let isShuttingDown = false;

function shutDown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Shutting down API');

  server.close((error) => {
    void finishShutdown(error);
  });
}

async function finishShutdown(error?: Error): Promise<void> {
  if (error !== undefined) {
    logger.error({ error }, 'Failed to close HTTP server cleanly');
    process.exitCode = 1;
  }

  try {
    await prisma.$disconnect();
  } catch (disconnectError: unknown) {
    logger.error({ error: disconnectError }, 'Failed to disconnect from PostgreSQL cleanly');
    process.exitCode = 1;
  }
}

process.once('SIGINT', shutDown);
process.once('SIGTERM', shutDown);
