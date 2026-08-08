import { createApp } from './app.js';
import { loadEnv } from './shared/config/env.js';
import { createLogger } from './shared/logging/logger.js';

const env = loadEnv();
const logger = createLogger(env);

const app = createApp({
  env,
  logger,
  // The database slice must replace this with a lightweight PostgreSQL check.
  readinessCheck: async () =>
    Promise.resolve({ ready: false, detail: 'Database layer is not initialized.' }),
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API listening');
});

function shutDown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down API');

  server.close((error) => {
    if (error !== undefined) {
      logger.error({ error }, 'Failed to close HTTP server cleanly');
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', shutDown);
process.once('SIGTERM', shutDown);
