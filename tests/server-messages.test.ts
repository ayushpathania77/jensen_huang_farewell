import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createHandlers } from '../server/handlers.js';
import { MessageInputError, readMessageBody, validateMessage } from '../server/messages.js';
import { MemoryTributeStore, RateLimitError, SupabaseTributeStore } from '../server/store.js';
import { createSession, VISITOR_COOKIE } from '../server/session.js';

const secret = 'message-tests-only-secret-with-more-than-32-characters';
const start = Date.UTC(2026, 10, 12, 12, 0, 0);
const submission = (body = 'Thank you for inspiring us to build.') => validateMessage({ body, requestId: randomUUID() });

async function invoke(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>, options: {
  method?: string; cookie?: string; body?: unknown; origin?: string | null; headers?: Record<string, string>;
} = {}) {
  const headers: Record<string, string> = { host: 'localhost:5173', 'content-type': 'application/json', ...options.headers };
  if (options.origin !== null) headers.origin = options.origin ?? 'http://localhost:5173';
  if (options.cookie) headers.cookie = options.cookie;
  const request = { method: options.method ?? 'POST', headers, body: options.body, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
  const responseHeaders = new Map<string, string>();
  let body = '';
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) { responseHeaders.set(name.toLowerCase(), String(value)); },
    end(value: string) { body = value; },
  } as unknown as ServerResponse;
  await handler(request, response);
  return { status: response.statusCode, json: JSON.parse(body), headers: responseHeaders, cookie: responseHeaders.get('set-cookie')?.split(';')[0] };
}

test('message validation normalizes plain text and checks Unicode length, links, controls, and request IDs', () => {
  const id = randomUUID();
  assert.deepEqual(validateMessage({ name: '  ', body: '  Thank you.  ', requestId: id }), {
    name: 'A fellow builder', body: 'Thank you.', requestId: id,
  });
  assert.equal(validateMessage({ body: '💚'.repeat(240), requestId: id }).body.length, 480);
  for (const body of ['', ' '.repeat(3), 'a'.repeat(241), 'visit https://example.com', 'www.example.org', 'example.dev', '<script>bad</script>', 'hello\u0001there']) {
    assert.throws(() => validateMessage({ body, requestId: id }), MessageInputError);
  }
  assert.throws(() => validateMessage({ name: 'a'.repeat(33), body: 'Thanks', requestId: id }), MessageInputError);
  assert.throws(() => validateMessage({ body: 'Thanks', requestId: 'not-a-uuid' }), MessageInputError);
  assert.equal(validateMessage({ body: 'Thanks.\nKeep building.', requestId: id }).body, 'Thanks.\nKeep building.');
});

test('memory wall starts empty, shares real posts, and never duplicates a retried request', async () => {
  const store = new MemoryTributeStore(() => start);
  assert.deepEqual(await store.readPublicMessages(), { messages: [], totalMessages: 0 });
  const input = submission();
  const results = await Promise.all(Array.from({ length: 8 }, () => store.postMessage('visitor-a', 'network', input)));
  assert.equal(results.filter((result) => result.added).length, 1);
  assert.equal(new Set(results.map((result) => result.message.id)).size, 1);
  const latest = await store.postMessage('visitor-b', 'network', submission('Good luck with your next chapter.'));
  const wall = await store.readPublicMessages();
  assert.equal(wall.totalMessages, 2);
  assert.equal(wall.messages[0].id, latest.message.id);
  assert.deepEqual(Object.keys(wall.messages[0]).sort(), ['body', 'createdAt', 'id', 'name']);
});

test('message quotas are shared, retries are free, and a failed network quota does not consume browser quota', async () => {
  let clock = start;
  const store = new MemoryTributeStore(() => clock);
  const original = submission();
  await store.postMessage('visitor-a', 'network-a', original);
  await store.postMessage('visitor-a', 'network-a', submission());
  await store.postMessage('visitor-a', 'network-a', submission());
  await assert.rejects(store.postMessage('visitor-a', 'network-a', submission()), RateLimitError);
  assert.equal((await store.postMessage('visitor-a', 'network-a', original)).added, false);
  clock += 600_000;
  assert.equal((await store.postMessage('visitor-a', 'network-a', submission())).added, true);

  for (let i = 0; i < 20; i += 1) await store.postMessage(`other-${i}`, 'full-network', submission());
  await assert.rejects(store.postMessage('visitor-new', 'full-network', submission()), RateLimitError);
  for (let i = 0; i < 3; i += 1) assert.equal((await store.postMessage('visitor-new', 'other-network', submission())).added, true);
});

test('message API supports public reads, authenticated anonymous writes, and safe failures', async () => {
  const api = createHandlers({ store: new MemoryTributeStore(() => start), sessionSecret: secret, secureCookies: false, trustProxy: false, now: () => start });
  const empty = await invoke(api.messages, { method: 'GET', origin: null });
  assert.deepEqual(empty.json, { messages: [], totalMessages: 0 });
  assert.equal(empty.headers.get('cache-control'), 'no-store');
  assert.equal(empty.headers.has('set-cookie'), false);
  const input = submission();
  assert.equal((await invoke(api.messages, { body: input })).status, 409);
  const session = await invoke(api.presence);
  const post = await invoke(api.messages, { cookie: session.cookie, body: input });
  assert.equal(post.status, 200);
  assert.equal(post.json.added, true);
  assert.equal(post.json.message.name, 'A fellow builder');
  const retry = await invoke(api.messages, { cookie: session.cookie, body: JSON.stringify(input) });
  assert.equal(retry.json.added, false);
  assert.equal(retry.json.message.id, post.json.message.id);
  assert.equal((await invoke(api.messages, { method: 'GET', origin: null })).json.totalMessages, 1);
  assert.equal((await invoke(api.messages, { cookie: session.cookie, body: input, origin: 'https://other.example' })).status, 403);
  assert.equal((await invoke(api.messages, { cookie: session.cookie, body: { ...input, body: 'https://spam.example' } })).status, 400);
  assert.equal((await invoke(api.messages, { cookie: session.cookie, body: '{broken' })).status, 400);
  assert.equal((await invoke(api.messages, { cookie: session.cookie, body: input, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await invoke(api.messages, { cookie: session.cookie, body: { ...input, body: 'a'.repeat(5000) } })).status, 413);
  assert.equal((await invoke(api.messages, { method: 'DELETE' })).status, 405);
});

test('raw request streams enforce actual bytes even without Content-Length', async () => {
  const valid = Readable.from([Buffer.from('{"body":"Hello",'), Buffer.from('"requestId":"test"}')]) as IncomingMessage;
  valid.headers = { 'content-type': 'application/json' };
  assert.deepEqual(await readMessageBody(valid), { body: 'Hello', requestId: 'test' });
  const oversized = Readable.from([Buffer.alloc(3000, 'a'), Buffer.alloc(3000, 'a')]) as IncomingMessage;
  oversized.headers = { 'content-type': 'application/json' };
  await assert.rejects(readMessageBody(oversized), (error: unknown) => error instanceof MessageInputError && error.status === 413);
});

test('Supabase message adapter uses narrow RPCs and accepts the longer message quota retry window', async () => {
  const message = { id: randomUUID(), name: 'A fellow builder', body: 'Thank you.', createdAt: new Date(start).toISOString() };
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const adapter = new SupabaseTributeStore('https://project.supabase.co', 'server-key', (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(String(url).endsWith('tribute_messages_read')
      ? { messages: [message], totalMessages: 1 } : { message, totalMessages: 1, added: true }));
  }) as typeof fetch);
  assert.equal((await adapter.readPublicMessages()).messages[0].id, message.id);
  assert.equal((await adapter.postMessage('visitor', 'network', submission())).added, true);
  assert.equal(requests[0].body.p_limit, 30);
  assert.equal(requests[1].body.p_visitor_hash, 'visitor');
  const limited = new SupabaseTributeStore('https://project.supabase.co', 'server-key', (async () =>
    new Response(JSON.stringify({ message: 'RATE_LIMITED', details: '450' }), { status: 400 })) as typeof fetch);
  await assert.rejects(limited.postMessage('visitor', 'network', submission()), (error: unknown) => error instanceof RateLimitError && error.retryAfterSeconds === 450);
});

test('a removed message maps to a safe HTTP 410 without revealing its hidden contents', async () => {
  const store = new SupabaseTributeStore('https://project.supabase.co', 'server-key', (async () =>
    new Response(JSON.stringify({ message: 'MESSAGE_REMOVED', details: 'private removed message contents' }), { status: 400 })) as typeof fetch);
  await assert.rejects(store.postMessage('visitor', 'network', submission()), (error: unknown) =>
    error instanceof MessageInputError && error.status === 410 && error.code === 'MESSAGE_REMOVED');
  const api = createHandlers({ store, sessionSecret: secret, secureCookies: false, trustProxy: false, now: () => start });
  const cookie = `${VISITOR_COOKIE}=${createSession(secret, start)}`;
  const result = await invoke(api.messages, { cookie, body: submission() });
  assert.equal(result.status, 410);
  assert.deepEqual(result.json, { error: { code: 'MESSAGE_REMOVED', message: 'This message was removed. Please write a new farewell.' } });
});
