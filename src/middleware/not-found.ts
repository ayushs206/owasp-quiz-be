import type { NextFunction, Request, Response } from 'express';

import { ProblemError } from '../shared/errors/problem.js';

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(
    new ProblemError({
      type: 'https://quiz.example/problems/not-found',
      title: 'Resource not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: `No route exists for ${req.method} ${req.path}.`,
    }),
  );
}
