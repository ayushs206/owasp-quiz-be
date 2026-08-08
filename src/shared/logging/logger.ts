import pino, { type Logger } from 'pino';

import type { Env } from '../config/env.js';

export function createLogger(config: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: {
      service: 'owasp-tiet-quiz-backend',
      environment: config.NODE_ENV,
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        '*.accessToken',
        '*.refreshToken',
        '*.signedUrl',
      ],
      censor: '[REDACTED]',
    },
  });
}
