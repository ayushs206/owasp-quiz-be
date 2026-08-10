import express from 'express';
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pino from 'pino';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import type { JwksFetcher } from '../../lib/supabase.js';
import { createErrorHandler } from '../../middleware/error-handler.js';
import { requestId } from '../../middleware/request-id.js';
import type { Env } from '../../shared/config/env.js';
import type { ProblemBody } from '../../shared/errors/problem.js';
import { createAuthMiddleware } from './middleware.js';
import { verifyAuthToken } from './service.js';

type TestPrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

const mockEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3001,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_JWKS_URL: 'https://test-project.supabase.co/auth/v1/.well-known/jwks.json',
  SUPABASE_JWT_ISSUER: 'https://test-project.supabase.co/auth/v1',
  SUPABASE_JWT_AUDIENCE: 'authenticated',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SUPABASE_STORAGE_BUCKET: 'quiz-media',
  ALLOWED_EMAIL_DOMAINS: ['thapar.edu'],
  CORS_ORIGINS: ['http://localhost:3000'],
};

describe('Auth Service and Middleware', () => {
  let privateKey: TestPrivateKey;
  let invalidPrivateKey: TestPrivateKey;
  let jwksFetcher: JwksFetcher;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = 'test-key-id';
    publicJwk.alg = 'RS256';

    const invalidKeyPair = await generateKeyPair('RS256');
    invalidPrivateKey = invalidKeyPair.privateKey;

    jwksFetcher = createLocalJWKSet({ keys: [publicJwk] });
  });

  async function createToken(
    claims: Record<string, unknown> = {},
    options: {
      issuer?: string;
      audience?: string;
      expiresIn?: string;
      signingKey?: TestPrivateKey;
    } = {},
  ): Promise<string> {
    const builder = new SignJWT({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      email: 'student@thapar.edu',
      email_verified: true,
      app_metadata: { provider: 'google' },
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
      .setIssuedAt()
      .setIssuer(options.issuer ?? mockEnv.SUPABASE_JWT_ISSUER)
      .setAudience(options.audience ?? mockEnv.SUPABASE_JWT_AUDIENCE)
      .setExpirationTime(options.expiresIn ?? '1h');

    return builder.sign(options.signingKey ?? privateKey);
  }

  describe('verifyAuthToken', () => {
    it('verifies a valid token and normalizes email', async () => {
      const token = await createToken({ email: '  Student@THAPAR.EDU  ' });
      const identity = await verifyAuthToken(token, mockEnv, jwksFetcher);

      expect(identity).toEqual({
        sub: '550e8400-e29b-41d4-a716-446655440000',
        email: 'student@thapar.edu',
      });
    });

    it('rejects provider: email even if providers array includes google', async () => {
      const token = await createToken({
        app_metadata: { provider: 'email', providers: ['email', 'google'] },
      });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects an empty or non-string token with 401', async () => {
      await expect(verifyAuthToken('', mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects a token signed with an untrusted key with 401', async () => {
      const token = await createToken({}, { signingKey: invalidPrivateKey });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects a token with wrong issuer with 401', async () => {
      const token = await createToken({}, { issuer: 'https://wrong-issuer.com' });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects a token with wrong audience with 401', async () => {
      const token = await createToken({}, { audience: 'wrong-audience' });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects an expired token with 401', async () => {
      const token = await createToken({}, { expiresIn: '-1s' });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects missing subject with 401', async () => {
      const token = await createToken({ sub: '' });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects non-UUID subject with 401', async () => {
      const token = await createToken({ sub: 'invalid-subject-uuid' });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects missing email with 401', async () => {
      const token = await createToken({ email: '' });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects unverified email with 401', async () => {
      const token = await createToken({ email_verified: false });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects token where only user_metadata.email_verified is true', async () => {
      const token = await createToken({
        email_verified: false,
        app_metadata: { provider: 'google', email_verified: false },
        user_metadata: { email_verified: true },
      });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects missing or non-Google provider with 401', async () => {
      const token = await createToken({ app_metadata: { provider: 'github' } });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('returns 403 EMAIL_DOMAIN_NOT_ALLOWED for valid token outside allowed domain', async () => {
      const token = await createToken({ email: 'student@gmail.com' });
      await expect(verifyAuthToken(token, mockEnv, jwksFetcher)).rejects.toMatchObject({
        status: 403,
        code: 'EMAIL_DOMAIN_NOT_ALLOWED',
      });
    });
  });

  describe('createAuthMiddleware Integration', () => {
    function buildTestApp(customJwks?: JwksFetcher): express.Express {
      const logger = pino({ level: 'silent' });
      const app = express();

      app.use(requestId);
      app.get(
        '/protected-test',
        createAuthMiddleware(mockEnv, customJwks ?? jwksFetcher),
        (req, res) => {
          res.status(200).json({ user: req.user });
        },
      );
      app.use(createErrorHandler(logger));

      return app;
    }

    it('returns 401 problem error for missing Authorization header', async () => {
      const app = buildTestApp();
      const response = await supertest(app).get('/protected-test');
      const body = response.body as ProblemBody;

      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(body).toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
        title: 'Unauthorized',
      });
      expect(body.requestId).toBeDefined();
    });

    it('returns 401 problem error for non-Bearer Authorization header', async () => {
      const app = buildTestApp();
      const response = await supertest(app)
        .get('/protected-test')
        .set('Authorization', 'Basic invalid-credentials');
      const body = response.body as ProblemBody;

      expect(response.status).toBe(401);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 problem error for malformed/invalid bearer token', async () => {
      const app = buildTestApp();
      const response = await supertest(app)
        .get('/protected-test')
        .set('Authorization', 'Bearer invalid-jwt-token');
      const body = response.body as ProblemBody;

      expect(response.status).toBe(401);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 problem error for valid identity with disallowed email domain', async () => {
      const app = buildTestApp();
      const token = await createToken({ email: 'student@outlook.com' });
      const response = await supertest(app)
        .get('/protected-test')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body).toMatchObject({
        status: 403,
        code: 'EMAIL_DOMAIN_NOT_ALLOWED',
        title: 'Email domain not allowed',
      });
    });

    it('authenticates valid token and attaches user to request context', async () => {
      const app = buildTestApp();
      const token = await createToken({ email: 'student@thapar.edu' });
      const response = await supertest(app)
        .get('/protected-test')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: {
          sub: '550e8400-e29b-41d4-a716-446655440000',
          email: 'student@thapar.edu',
        },
      });
    });

    it('accepts case-insensitive bearer scheme in Authorization header', async () => {
      const app = buildTestApp();
      const token = await createToken({ email: 'student@thapar.edu' });
      const response = await supertest(app)
        .get('/protected-test')
        .set('Authorization', `bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: {
          sub: '550e8400-e29b-41d4-a716-446655440000',
          email: 'student@thapar.edu',
        },
      });
    });

    it('returns 503 problem error when JWKS dependency encounters a network failure', async () => {
      const failingJwks: JwksFetcher = () => {
        throw new Error('JWKS endpoint network timeout');
      };
      const app = buildTestApp(failingJwks);
      const token = await createToken({ email: 'student@thapar.edu' });

      const response = await supertest(app)
        .get('/protected-test')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        title: 'Service unavailable',
      });
    });

    it('returns 503 problem error when JWKS throws JWKSTimeout error', async () => {
      const timeoutJwks: JwksFetcher = () => {
        throw new errors.JWKSTimeout();
      };
      const token = await createToken({ email: 'student@thapar.edu' });

      await expect(verifyAuthToken(token, mockEnv, timeoutJwks)).rejects.toMatchObject({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
    });
  });
});
