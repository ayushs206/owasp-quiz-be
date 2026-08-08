import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

import { responseRequestId } from '../../middleware/request-id.js';

export function createGeneralRateLimit(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(_req, res): void {
      res
        .status(429)
        .type('application/problem+json')
        .json({
          type: 'https://quiz.example/problems/rate-limit-exceeded',
          title: 'Too many requests',
          status: 429,
          code: 'RATE_LIMIT_EXCEEDED',
          detail: 'Wait before retrying this request.',
          requestId: responseRequestId(res),
        });
    },
  });
}
