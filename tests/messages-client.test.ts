import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  MessageDraftRequests, MessageRequestError, isMessagesPage, mergeAcknowledgedMessage, postMessage, readMessages,
  type PublicMessage,
} from '../src/lib/messages-client';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const messageId = '48a82dc6-0395-44b2-9f7a-cf4e040e8d70';
const requestId = 'c5a74274-c799-4081-8be0-0279f58846ae';
const nextRequestId = '6a5dfe69-9a34-4f4d-bfd0-a80e392d57f8';
const message: PublicMessage = { id: messageId, name: 'A fellow builder', body: 'Thank you for the inspiration.', createdAt: '2026-11-12T14:00:00.000Z' };
const submission = { name: '', body: message.body, requestId };

test('message reads use the shared endpoint and accept a validated page', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/messages');
    assert.equal(options?.method, 'GET');
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.body, undefined);
    return new Response(JSON.stringify({ messages: [message], totalMessages: 20 }));
  };
  assert.deepEqual(await readMessages(), { messages: [message], totalMessages: 20 });
});

test('corrupt message records, duplicate IDs, and fabricated totals are rejected', async () => {
  const invalid = [
    { messages: [message], totalMessages: 0 },
    { messages: [message], totalMessages: '10' },
    { messages: [message], totalMessages: Number.MAX_SAFE_INTEGER + 1 },
    { messages: [message, message], totalMessages: 2 },
    { messages: [{ ...message, id: 'not-an-id' }], totalMessages: 1 },
    { messages: [{ ...message, body: '' }], totalMessages: 1 },
    { messages: [{ ...message, body: 'x'.repeat(241) }], totalMessages: 1 },
    { messages: [{ ...message, name: ' ' }], totalMessages: 1 },
    { messages: [{ ...message, createdAt: '2026' }], totalMessages: 1 },
    { messages: [{ ...message, createdAt: '2026-99-99T00:00:00Z' }], totalMessages: 1 },
  ];
  for (const page of invalid) {
    assert.equal(isMessagesPage(page), false);
    globalThis.fetch = async () => new Response(JSON.stringify(page));
    await assert.rejects(readMessages(), (cause: unknown) => cause instanceof MessageRequestError && cause.code === 'INVALID_RESPONSE');
  }
});

test('uncertain retries reuse the same UUID after whitespace edits and revisiting a draft', () => {
  const identifiers = [requestId, nextRequestId, '0b6c6c4b-2a39-4dab-9b77-c2a381f30211'];
  const drafts = new MessageDraftRequests(() => identifiers.shift()!);
  const first = drafts.forDraft(' Ada ', ' Thank you. ');
  assert.deepEqual(drafts.forDraft('Ada', 'Thank you.'), first);
  const different = drafts.forDraft('Ada', 'Thank you for CUDA.');
  assert.notEqual(different.requestId, first.requestId);
  assert.equal(drafts.forDraft('Ada', 'Thank you.').requestId, first.requestId);
  first.body = 'Mutated caller copy';
  assert.equal(drafts.forDraft('Ada', 'Thank you.').body, 'Thank you.');
  drafts.acknowledge(first.requestId);
  assert.notEqual(drafts.forDraft('Ada', 'Thank you.').requestId, first.requestId);
  assert.equal(drafts.forDraft('Ada', 'Thank you for CUDA.').requestId, different.requestId);
});

test('draft validation allows Unicode and line breaks but rejects invalid content before requesting', async () => {
  let requested = false;
  globalThis.fetch = async () => { requested = true; throw new Error('should not fetch'); };
  const drafts = new MessageDraftRequests(() => requestId);
  assert.equal(drafts.forDraft('', 'Thank you 🙌\nKeep building.').body, 'Thank you 🙌\nKeep building.');
  assert.equal(drafts.forDraft('', '🙌'.repeat(240)).body.length, 480);
  for (const [name, body] of [['x'.repeat(33), 'Thanks'], ['', ' '], ['', '🙌'.repeat(241)], ['', '<b>Thanks</b>'], ['', 'Visit example.com'], ['Hello\nthere', 'Thanks'], ['', 'Thanks\u0000']]) {
    await assert.rejects(postMessage({ name, body, requestId }), (cause: unknown) => cause instanceof MessageRequestError && cause.code === 'INVALID_MESSAGE');
  }
  assert.equal(requested, false);
});

test('a lost response stays unconfirmed and the same request can receive a duplicate acknowledgement', async () => {
  const drafts = new MessageDraftRequests(() => requestId);
  const first = drafts.forDraft('', message.body);
  globalThis.fetch = async () => { throw new TypeError('network failure'); };
  await assert.rejects(postMessage(first), (cause: unknown) => cause instanceof MessageRequestError
    && cause.code === 'NETWORK_ERROR' && cause.message.includes('couldn’t confirm'));
  const retry = drafts.forDraft(' ', ` ${message.body} `);
  assert.equal(retry.requestId, requestId);
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.method, 'POST');
    assert.equal(options?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(options?.body as string), first);
    return new Response(JSON.stringify({ message, added: false, totalMessages: 1 }));
  };
  const acknowledged = await postMessage(retry);
  assert.equal(acknowledged.added, false);
  assert.equal(acknowledged.message.id, message.id);
});

test('posting requires a matching validated acknowledgement, not merely a successful HTTP status', async () => {
  for (const response of [
    { message, totalMessages: 1 },
    { message, added: true, totalMessages: 0 },
    { message: { ...message, body: 'A different draft' }, added: true, totalMessages: 1 },
    { message: { ...message, name: 'Someone else' }, added: true, totalMessages: 1 },
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify(response));
    await assert.rejects(postMessage(submission), (cause: unknown) => cause instanceof MessageRequestError && cause.code === 'INVALID_RESPONSE');
  }
});

test('server validation, rate and session errors map to safe instructions without exposing provider text', async () => {
  for (const [code, status, expected] of [
    ['INVALID_MESSAGE', 400, '240 characters'],
    ['RATE_LIMITED', 429, 'wait a little'],
    ['SESSION_REQUIRED', 409, 'your message stays here'],
    ['MESSAGE_REMOVED', 410, 'write a new farewell'],
    ['UNEXPECTED_SECRET', 503, 'couldn’t confirm'],
  ] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code, message: 'private-service-key-and-query' } }), { status });
    await assert.rejects(postMessage(submission), (cause: unknown) => cause instanceof MessageRequestError
      && cause.message.includes(expected) && !cause.message.includes('private-service-key') && !cause.message.includes('UNEXPECTED_SECRET'));
  }
});

test('aborting a request is forwarded to fetch and never returns an acknowledgement', async () => {
  let receivedSignal: AbortSignal | undefined;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    receivedSignal = options?.signal as AbortSignal;
    receivedSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const controller = new AbortController();
  const pending = postMessage(submission, controller.signal);
  controller.abort();
  await assert.rejects(pending, (cause: unknown) => cause instanceof MessageRequestError && cause.code === 'ABORTED');
  assert.equal(receivedSignal?.aborted, true);
  await assert.rejects(readMessages(controller.signal), (cause: unknown) => cause instanceof MessageRequestError && cause.code === 'ABORTED');
});

test('acknowledged messages merge immutably in date order and do not duplicate retries', () => {
  const newer = { ...message, id: nextRequestId, createdAt: '2026-11-12T15:00:00.000Z' };
  const current = [newer, message];
  Object.freeze(current);
  const merged = mergeAcknowledgedMessage(current, { message, added: false, totalMessages: 2 });
  assert.deepEqual(merged, [newer, message]);
  assert.notEqual(merged, current);
  assert.deepEqual(current, [newer, message]);
});
