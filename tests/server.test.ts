import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { createHandlers, validateEnvironment } from '../server/handlers.js';
import { createSession, readSession, SESSION_MAX_AGE_SECONDS, VISITOR_COOKIE, visitorHash } from '../server/session.js';
import { MemoryTributeStore, RateLimitError, SupabaseTributeStore, type TributeStore } from '../server/store.js';

const secret = 'test-only-session-secret-with-more-than-32-characters';
const start = Date.UTC(2026, 10, 12, 12, 0, 0);

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  options: { method?: string; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { host: 'localhost:5173', ...options.headers };
  if (options.origin !== null) headers.origin = options.origin ?? 'http://localhost:5173';
  if (options.cookie) headers.cookie = options.cookie;
  const request = { method: options.method ?? 'POST', headers, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage;
  const responseHeaders = new Map<string, string>();
  let body = '';
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) { responseHeaders.set(name.toLowerCase(), String(value)); },
    end(value: string) { body = value; },
  } as unknown as ServerResponse;
  await handler(request, response);
  return {
    status: response.statusCode,
    headers: responseHeaders,
    json: JSON.parse(body) as Record<string, any>,
    cookie: responseHeaders.get('set-cookie')?.split(';')[0],
  };
}

function handlers(store: TributeStore = new MemoryTributeStore(() => start)) {
  return createHandlers({ store, sessionSecret: secret, secureCookies: true, trustProxy: false, now: () => start });
}

test('concurrent submissions are idempotent and distinct browser contributions remain shared', async () => {
  const store = new MemoryTributeStore(() => start);
  const repeated = await Promise.all(Array.from({ length: 30 }, () => store.tribute('same-browser', 'shared-ip')));
  assert.equal(repeated.filter((entry) => entry.added).length, 1);
  const separate = await Promise.all(Array.from({ length: 40 }, (_, i) => store.tribute(`browser-${i}`, `ip-${i}`)));
  assert.equal(separate.filter((entry) => entry.added).length, 40);
  const state = await store.presence('observer', 'observer-ip');
  assert.equal(state.totalTributes, 41);
  assert.equal(state.participated, false);
});

test('presence deduplicates browser tabs and expires on server time after 90 seconds', async () => {
  let clock = start;
  const store = new MemoryTributeStore(() => clock);
  await store.presence('browser-a', 'ip-a');
  await store.presence('browser-a', 'ip-a');
  assert.equal((await store.presence('browser-b', 'ip-b')).onlineNow, 2);
  clock += 89_999;
  assert.equal((await store.presence('observer', 'ip-c')).onlineNow, 3);
  clock += 1;
  assert.equal((await store.presence('observer', 'ip-c')).onlineNow, 1);
});

test('rate limits are shared by network key and reset after the minute window', async () => {
  let clock = start;
  const store = new MemoryTributeStore(() => clock);
  for (let i = 0; i < 60; i += 1) await store.tribute(`browser-${i}`, 'same-network');
  await assert.rejects(store.tribute('one-too-many', 'same-network'), RateLimitError);
  assert.equal((await store.presence('observer', 'other-network')).totalTributes, 60);
  clock += 60_000;
  assert.equal((await store.tribute('one-too-many', 'same-network')).added, true);
});

test('signed cookies reject tampering and expiration while hashes remain stable', () => {
  const session = createSession(secret, start);
  assert.equal(readSession(`${VISITOR_COOKIE}=${session}`, secret, start), session);
  assert.equal(readSession(`${VISITOR_COOKIE}=${session.slice(0, -1)}!`, secret, start), null);
  const signatureStart = session.lastIndexOf('.') + 1;
  const forged = `${session.slice(0, signatureStart)}${session[signatureStart] === 'a' ? 'b' : 'a'}${session.slice(signatureStart + 1)}`;
  assert.equal(readSession(`${VISITOR_COOKIE}=${forged}`, secret, start), null);
  assert.equal(readSession(`${VISITOR_COOKIE}=${session}`, `${secret}-wrong`, start), null);
  assert.equal(readSession(`${VISITOR_COOKIE}=${session}`, secret, start + SESSION_MAX_AGE_SECONDS * 1000), null);
  assert.equal(visitorHash(session, secret).length, 64);
  assert.equal(visitorHash(session, secret), visitorHash(session, secret));
});

test('API initializes a secure anonymous session, persists participation, and exposes shared totals', async () => {
  const api = handlers();
  const first = await invoke(api.presence);
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { totalTributes: 0, onlineNow: 1, participated: false });
  assert.match(first.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax; Secure/);
  assert.equal(first.headers.get('cache-control'), 'no-store');

  const joined = await invoke(api.tribute, { cookie: first.cookie });
  assert.equal(joined.json.added, true);
  assert.equal(joined.json.totalTributes, 1);
  const retried = await invoke(api.tribute, { cookie: first.cookie });
  assert.equal(retried.json.added, false);
  assert.equal(retried.json.totalTributes, 1);
  const returning = await invoke(api.presence, { cookie: first.cookie });
  assert.equal(returning.json.participated, true);
  assert.equal(returning.headers.has('set-cookie'), false);

  const second = await invoke(api.presence);
  assert.equal(second.json.totalTributes, 1);
  assert.equal(second.json.onlineNow, 2);
  assert.equal(second.json.participated, false);
});

test('API rejects cross-origin, missing-origin, unsupported, oversized, and unsigned requests', async () => {
  const api = handlers();
  assert.equal((await invoke(api.presence, { origin: 'https://other.example' })).status, 403);
  assert.equal((await invoke(api.presence, { origin: null })).status, 403);
  assert.equal((await invoke(api.presence, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const wrongMethod = await invoke(api.presence, { method: 'GET' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal((await invoke(api.presence, { headers: { 'content-length': '2048' } })).status, 413);
  const noSession = await invoke(api.tribute);
  assert.equal(noSession.status, 409);
  assert.equal(noSession.json.error.code, 'SESSION_REQUIRED');
  assert.equal((await invoke(api.tribute, { cookie: `${VISITOR_COOKIE}=forged` })).status, 409);
});

test('API hides provider errors and returns actionable shared rate limiting', async () => {
  const failedStore: TributeStore = {
    async presence() { throw new Error('private database details and credentials'); },
    async tribute() { throw new Error('private database details and credentials'); },
    async readPublicMessages() { throw new Error('private database details and credentials'); },
    async postMessage() { throw new Error('private database details and credentials'); },
  };
  const failed = await invoke(handlers(failedStore).presence);
  assert.equal(failed.status, 503);
  assert.equal(JSON.stringify(failed.json).includes('private'), false);
  assert.equal(failed.headers.has('set-cookie'), false);

  const limitedStore: TributeStore = {
    async presence() { throw new RateLimitError(17); },
    async tribute() { throw new RateLimitError(17); },
    async readPublicMessages() { throw new RateLimitError(17); },
    async postMessage() { throw new RateLimitError(17); },
  };
  const limited = await invoke(handlers(limitedStore).presence);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '17');
  assert.equal(limited.json.retryAfterSeconds, 17);
});

test('only deployment handlers trust the proxy protocol for same-origin checks', async () => {
  const deployed = createHandlers({
    store: new MemoryTributeStore(() => start), sessionSecret: secret,
    secureCookies: true, trustProxy: true, now: () => start,
  });
  const headers = { host: 'tribute.example', 'x-forwarded-proto': 'https', 'x-forwarded-for': '192.0.2.1' };
  const accepted = await invoke(deployed.presence, { origin: 'https://tribute.example', headers });
  assert.equal(accepted.status, 200);
  const wrongScheme = await invoke(deployed.presence, { origin: 'http://tribute.example', headers });
  assert.equal(wrongScheme.status, 403);
  const local = await invoke(handlers().presence, { origin: 'https://tribute.example', headers });
  assert.equal(local.status, 403);
});

test('production and preview deployments cannot use the development memory adapter', () => {
  assert.doesNotThrow(() => validateEnvironment({ TRIBUTE_STORE: 'memory', SESSION_SECRET: secret }));
  assert.throws(() => validateEnvironment({ TRIBUTE_STORE: 'memory', SESSION_SECRET: secret, VERCEL_ENV: 'production' }), /forbidden/);
  assert.throws(() => validateEnvironment({ TRIBUTE_STORE: 'memory', SESSION_SECRET: secret, VERCEL_ENV: 'preview' }), /local development/);
  assert.throws(() => validateEnvironment({ SESSION_SECRET: secret }), /not configured/);
  assert.throws(() => validateEnvironment({ TRIBUTE_STORE: 'memory', SESSION_SECRET: 'short' }), /32/);
});

test('Supabase adapter uses server-side RPC and validates provider responses', async () => {
  let requestedUrl = '';
  let requestedBody = '';
  const request = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(url);
    requestedBody = String(init?.body);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer server-only-key');
    return new Response(JSON.stringify({ totalTributes: 8, onlineNow: 2, participated: true, added: false }), { status: 200 });
  }) as typeof fetch;
  const store = new SupabaseTributeStore('https://project.supabase.co/', 'server-only-key', request);
  const state = await store.tribute('visitor-hash', 'network-hash');
  assert.equal(state.totalTributes, 8);
  assert.equal(requestedUrl, 'https://project.supabase.co/rest/v1/rpc/tribute_join');
  assert.deepEqual(JSON.parse(requestedBody), { p_visitor_hash: 'visitor-hash', p_rate_key: 'network-hash' });

  const invalid = new SupabaseTributeStore('https://project.supabase.co', 'key', (async () =>
    new Response(JSON.stringify({ totalTributes: -1, onlineNow: 1, participated: false }))) as typeof fetch);
  await assert.rejects(invalid.presence('visitor', 'network'), /invalid response/);
  const limited = new SupabaseTributeStore('https://project.supabase.co', 'key', (async () =>
    new Response(JSON.stringify({ message: 'RATE_LIMITED', details: '12' }), { status: 400 })) as typeof fetch);
  await assert.rejects(limited.presence('visitor', 'network'), (error: unknown) => error instanceof RateLimitError && error.retryAfterSeconds === 12);
});
