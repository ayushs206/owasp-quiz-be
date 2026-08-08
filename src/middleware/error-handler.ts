import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

import { ProblemError } from '../shared/errors/problem.js';
import { responseRequestId } from './request-id.js';

function normalizeError(error: unknown): ProblemError {
  if (error instanceof ProblemError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new ProblemError({
      type: 'https://quiz.example/problems/validation-error',
      title: 'Request validation failed',
      status: 400,
      code: 'VALIDATION_ERROR',
      detail: 'The request contains invalid data.',
    });
  }

  return new ProblemError({
    type: 'https://quiz.example/problems/internal-server-error',
    title: 'Internal server error',
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    detail: 'The server could not complete the request.',
  });
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next): void => {
    const problem = normalizeError(error);
    const requestId = responseRequestId(res);

    if (problem.status >= 500) {
      logger.error({ error, requestId }, 'Unhandled request error');
    }

    res.status(problem.status).type('application/problem+json').json(problem.toBody(requestId));
  };
}
