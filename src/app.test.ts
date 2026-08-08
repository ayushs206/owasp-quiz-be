import { randomUUID } from 'node:crypto';

import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Express } from 'express';

import { createApp } from './app.js';
import { loadEnv } from './shared/config/env.js';

const problemSchema = z.object({
  status: z.number(),
  code: z.string(),
  requestId: z.string(),
});

function createTestApp(ready = true): Express {
  const env = loadEnv({
    NODE_ENV: 'test',
    PORT: '3001',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/quiz',
    DIRECT_URL: 'postgresql://user:password@localhost:5432/quiz',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_JWKS_URL: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
    SUPABASE_JWT_ISSUER: 'https://example.supabase.co/auth/v1',
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    ALLOWED_EMAIL_DOMAINS: 'example.edu',
    CORS_ORIGINS: 'http://localhost:3000',
  });

  return createApp({
    env,
    logger: pino({ level: 'silent' }),
    readinessCheck: async () => Promise.resolve({ ready }),
  });
}

describe('application foundation', () => {
  it('serves a liveness check with security and request-id headers', async () => {
    const response = await request(createTestApp()).get('/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('preserves a valid caller request ID', async () => {
    const requestId = randomUUID();
    const response = await request(createTestApp())
      .get('/health/live')
      .set('x-request-id', requestId)
      .expect(200);

    expect(response.headers['x-request-id']).toBe(requestId);
  });

  it('reports readiness when dependency checks succeed', async () => {
    const response = await request(createTestApp()).get('/health/ready').expect(200);

    expect(response.body).toEqual({ status: 'ready' });
  });

  it('returns an RFC 7807 response when the service is not ready', async () => {
    const response = await request(createTestApp(false)).get('/health/ready').expect(503);
    const problem = problemSchema.parse(response.body);

    expect(response.type).toBe('application/problem+json');
    expect(problem).toMatchObject({
      status: 503,
      code: 'SERVICE_NOT_READY',
    });
    expect(problem.requestId).toBe(response.headers['x-request-id']);
  });

  it('returns an RFC 7807 response for unknown routes', async () => {
    const response = await request(createTestApp()).get('/missing').expect(404);
    const problem = problemSchema.parse(response.body);

    expect(response.type).toBe('application/problem+json');
    expect(problem).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
