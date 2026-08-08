import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('uses the validated log level and service bindings', () => {
    const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

    expect(logger.level).toBe('silent');
    expect(logger.bindings()).toMatchObject({
      service: 'owasp-tiet-quiz-backend',
      environment: 'test',
    });
  });
});
