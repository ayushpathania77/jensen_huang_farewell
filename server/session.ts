import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const VISITOR_COOKIE = 'tribute_visitor';
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function digest(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSession(secret: string, now = Date.now()): string {
  const payload = `v1.${randomBytes(24).toString('base64url')}.${Math.floor(now / 1000)}`;
  return `${payload}.${digest(secret, payload)}`;
}

export function readSession(cookieHeader: string | undefined, secret: string, now = Date.now()): string | null {
  const cookie = cookieHeader?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${VISITOR_COOKIE}=`))?.slice(VISITOR_COOKIE.length + 1);
  if (!cookie || cookie.length > 180) return null;
  const match = /^(v1\.[A-Za-z0-9_-]{32}\.(\d{10}))\.([A-Za-z0-9_-]{43})$/.exec(cookie);
  if (!match) return null;
  const issuedAt = Number(match[2]);
  const currentSeconds = Math.floor(now / 1000);
  if (issuedAt > currentSeconds + 300 || currentSeconds - issuedAt >= SESSION_MAX_AGE_SECONDS) return null;
  const expected = Buffer.from(digest(secret, match[1]));
  const actual = Buffer.from(match[3]);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? cookie : null;
}

export function sessionCookie(value: string, secure: boolean): string {
  return `${VISITOR_COOKIE}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function visitorHash(session: string, secret: string): string {
  return createHmac('sha256', secret).update(`visitor:${session.split('.')[1]}`).digest('hex');
}

export function rateHash(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(`rate:${ip}`).digest('hex');
}
