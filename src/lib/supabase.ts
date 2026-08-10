import {
  createRemoteJWKSet,
  type GetKeyFunction,
  type JWSHeaderParameters,
  type FlattenedJWSInput,
} from 'jose';

export type JwksFetcher = GetKeyFunction<JWSHeaderParameters, FlattenedJWSInput>;

const jwksCache = new Map<string, JwksFetcher>();

export function createSupabaseJwks(jwksUrl: string): JwksFetcher {
  return createRemoteJWKSet(new URL(jwksUrl));
}

export function getSupabaseJwks(jwksUrl: string): JwksFetcher {
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createSupabaseJwks(jwksUrl);
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}
