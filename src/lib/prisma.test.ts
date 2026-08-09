import { describe, expect, it, vi } from 'vitest';

import { createDatabaseReadinessCheck } from './prisma.js';

describe('database readiness', () => {
  it('reports ready after a successful database probe', async () => {
    const probe = vi.fn().mockResolvedValue([{ '?column?': 1 }]);

    await expect(createDatabaseReadinessCheck(probe)()).resolves.toEqual({ ready: true });
    expect(probe).toHaveBeenCalledOnce();
  });

  it('returns a safe dependency error when PostgreSQL is unavailable', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('connection details'));

    await expect(createDatabaseReadinessCheck(probe)()).resolves.toEqual({
      ready: false,
      detail: 'PostgreSQL is unavailable.',
    });
  });
});
