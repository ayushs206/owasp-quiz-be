import { Router } from 'express';

import { ProblemError } from '../../shared/errors/problem.js';

export interface ReadinessResult {
  ready: boolean;
  detail?: string;
}

export type ReadinessCheck = () => Promise<ReadinessResult>;

export function createHealthRouter(readinessCheck: ReadinessCheck): Router {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    const result = await readinessCheck();

    if (!result.ready) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/service-not-ready',
        title: 'Service not ready',
        status: 503,
        code: 'SERVICE_NOT_READY',
        detail: result.detail ?? 'A required dependency is unavailable.',
      });
    }

    res.json({ status: 'ready' });
  });

  return router;
}
