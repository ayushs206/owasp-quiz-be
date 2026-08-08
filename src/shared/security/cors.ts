import type { CorsOptions } from 'cors';

export function createCorsOptions(allowedOrigins: readonly string[]): CorsOptions {
  const allowlist = new Set(allowedOrigins);

  return {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
    origin(origin, callback): void {
      callback(null, origin === undefined || allowlist.has(origin));
    },
  };
}
