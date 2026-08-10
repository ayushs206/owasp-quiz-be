import { jwtVerify, type JWTPayload } from 'jose';

import { getSupabaseJwks, type JwksFetcher } from '../../lib/supabase.js';
import type { Env } from '../../shared/config/env.js';
import { ProblemError } from '../../shared/errors/problem.js';

export interface AuthenticatedIdentity {
  sub: string;
  email: string;
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
  } catch {
    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }

  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }

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
  const userMetadata =
    typeof payload.user_metadata === 'object' && payload.user_metadata !== null
      ? (payload.user_metadata as Record<string, unknown>)
      : {};

  const isEmailVerified =
    payload.email_verified === true ||
    appMetadata.email_verified === true ||
    userMetadata.email_verified === true;

  if (!isEmailVerified) {
    throw new ProblemError({
      type: 'https://quiz.example/problems/unauthorized',
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid authentication token.',
    });
  }

  const provider = appMetadata.provider;
  const providers = Array.isArray(appMetadata.providers) ? appMetadata.providers : [];
  const isGoogle = provider === 'google' || providers.includes('google');

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
    sub: payload.sub,
    email: normalizedEmail,
  };
}
