import { errors, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';

import { getSupabaseJwks, type JwksFetcher } from '../../lib/supabase.js';
import type { Env } from '../../shared/config/env.js';
import { ProblemError } from '../../shared/errors/problem.js';

export interface AuthenticatedIdentity {
  sub: string;
  email: string;
}

function isJwksNetworkFailure(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
    return true;
  }
  if (error instanceof errors.JOSEError) {
    return (
      error.code === 'ERR_JOSE_GENERIC' ||
      error.code === 'ERR_JWKS_TIMEOUT' ||
      error.code === 'ERR_JWKS_INVALID'
    );
  }
  return true;
}

function hasOAuthAuthenticationMethod(amr: unknown): boolean {
  return (
    Array.isArray(amr) &&
    amr.some(
      (entry) =>
        entry === 'oauth' ||
        (typeof entry === 'object' &&
          entry !== null &&
          (entry as Record<string, unknown>).method === 'oauth'),
    )
  );
}

export async function verifyAuthToken(
  token: string,
  env: Env,
  customJwks?: JwksFetcher,
): Promise<AuthenticatedIdentity> {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }

  const jwks = customJwks ?? getSupabaseJwks(env.SUPABASE_JWKS_URL);

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, jwks, {
      issuer: env.SUPABASE_JWT_ISSUER,
      audience: env.SUPABASE_JWT_AUDIENCE,
    });
    payload = result.payload;
  } catch (error) {
    if (isJwksNetworkFailure(error)) {
      throw new ProblemError({
        type: 'https://quiz.example/problems/service-unavailable',
        title: 'Service unavailable',
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        detail: 'Authentication dependency is temporarily unavailable.',
      });
    }

    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }

  const subResult = z.string().uuid().safeParse(payload.sub);
  if (!subResult.success) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }
  const sub = subResult.data;

  if (!payload.email || typeof payload.email !== 'string' || payload.email.trim() === '') {
    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }

  const appMetadata =
    typeof payload.app_metadata === 'object' && payload.app_metadata !== null
      ? (payload.app_metadata as Record<string, unknown>)
      : {};

  const isEmailVerified = payload.email_verified === true || appMetadata.email_verified === true;

  if (!isEmailVerified) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }

  const isGoogle = appMetadata.provider === 'google' && hasOAuthAuthenticationMethod(payload.amr);

  if (!isGoogle) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }

  const normalizedEmail = payload.email.trim().toLowerCase();
  const parts = normalizedEmail.split('@');
  const domain = parts.length === 2 ? parts[1] : '';

  const allowedDomains = env.ALLOWED_EMAIL_DOMAINS.map((d) => d.trim().toLowerCase());
  if (!domain || !allowedDomains.includes(domain)) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/email-domain-not-allowed',
      title: 'Email domain not allowed',
      status: 403,
      code: 'EMAIL_DOMAIN_NOT_ALLOWED',
      detail: 'The email domain is not permitted to access this system.',
    });
  }

  return {
    sub,
    email: normalizedEmail,
  };
}
