import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

const validEnvironment: NodeJS.ProcessEnv = {
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
  ALLOWED_EMAIL_DOMAINS: 'example.edu, students.example.edu',
  CORS_ORIGINS: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('parses and normalizes valid environment values', () => {
    const env = loadEnv(validEnvironment);

    expect(env.PORT).toBe(3001);
    expect(env.ALLOWED_EMAIL_DOMAINS).toEqual(['example.edu', 'students.example.edu']);
  });

  it('rejects missing required values without printing secrets', () => {
    const invalidEnvironment = { ...validEnvironment };
    delete invalidEnvironment.DATABASE_URL;

    expect(() => loadEnv(invalidEnvironment)).toThrow('DATABASE_URL');
  });
});
