import crypto from 'node:crypto';

export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512';

export const JWT_ALGORITHMS: JwtAlgorithm[] = ['HS256', 'HS384', 'HS512'];

const DIGEST: Record<JwtAlgorithm, string> = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
};

export class JwtError extends Error {}

const b64urlEncode = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function b64urlDecode(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

function sign(data: string, secret: string, algorithm: JwtAlgorithm): string {
  return b64urlEncode(crypto.createHmac(DIGEST[algorithm], secret).update(data).digest());
}

export interface JwtPayload {
  [claim: string]: unknown;
  exp?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
}

export interface VerifyOptions {
  secret: string;
  algorithms?: JwtAlgorithm[];
  issuer?: string;
  audience?: string;
  /** Seconds of leeway for exp and nbf, for clock skew. */
  clockTolerance?: number;
}

/**
 * Verify an HMAC-signed JWT.
 *
 * Only the HS family is supported. RS and ES would mean key files and a
 * larger surface, and a mock server is not where signature schemes are
 * exercised — this exists so a route can require a plausible token.
 */
export function verifyJwt(token: string, options: VerifyOptions): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('jwt malformed');

  const [encodedHeader, encodedPayload, signature] = parts;

  let header: { alg?: string; typ?: string };
  let payload: JwtPayload;
  try {
    header = JSON.parse(b64urlDecode(encodedHeader).toString('utf8'));
    payload = JSON.parse(b64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    throw new JwtError('jwt malformed');
  }

  const allowed = options.algorithms ?? ['HS256'];
  const alg = header.alg as JwtAlgorithm | undefined;

  // "none" and unlisted algorithms are rejected outright; accepting the
  // token's own claim about how to check it is the classic JWT hole.
  if (!alg || !allowed.includes(alg)) {
    throw new JwtError(`algorithm "${header.alg ?? 'none'}" is not allowed`);
  }

  const expected = sign(`${encodedHeader}.${encodedPayload}`, options.secret, alg);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new JwtError('invalid signature');
  }

  const now = Math.floor(Date.now() / 1000);
  const tolerance = options.clockTolerance ?? 0;

  if (typeof payload.exp === 'number' && now >= payload.exp + tolerance) {
    throw new JwtError('jwt expired');
  }
  if (typeof payload.nbf === 'number' && now < payload.nbf - tolerance) {
    throw new JwtError('jwt not active yet');
  }
  if (options.issuer !== undefined && payload.iss !== options.issuer) {
    throw new JwtError('issuer mismatch');
  }
  if (options.audience !== undefined) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(options.audience)) throw new JwtError('audience mismatch');
  }

  return payload;
}

export interface SignOptions {
  secret: string;
  algorithm?: JwtAlgorithm;
  /** Seconds until expiry. Omit for a token with no exp. */
  expiresInSeconds?: number;
}

export function signJwt(payload: JwtPayload, options: SignOptions): string {
  const algorithm = options.algorithm ?? 'HS256';
  const now = Math.floor(Date.now() / 1000);

  const body: JwtPayload = {
    iat: now,
    ...payload,
    ...(options.expiresInSeconds !== undefined ? { exp: now + options.expiresInSeconds } : {}),
  };

  const encodedHeader = b64urlEncode(JSON.stringify({ alg: algorithm, typ: 'JWT' }));
  const encodedPayload = b64urlEncode(JSON.stringify(body));
  const data = `${encodedHeader}.${encodedPayload}`;

  return `${data}.${sign(data, options.secret, algorithm)}`;
}
