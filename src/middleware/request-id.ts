import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming !== undefined && uuidPattern.test(incoming) ? incoming : randomUUID();

  req.headers['x-request-id'] = id;
  res.setHeader('x-request-id', id);
  next();
}

export function responseRequestId(res: Response): string {
  const value = res.getHeader('x-request-id');
  return typeof value === 'string' ? value : randomUUID();
}
