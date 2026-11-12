import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { requestTributeState, TributeRequestError } from '../src/lib/tribute-client';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('rejects corrupt or non-numeric totals rather than displaying fabricated counts', async () => {
  for (const total of [-1, 1.5, '19', Number.MAX_SAFE_INTEGER + 1]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ totalTributes: total, onlineNow: 1, participated: false }));
    await assert.rejects(requestTributeState('presence'), (error: unknown) => error instanceof TributeRequestError && error.code === 'INVALID_RESPONSE');
  }
});

test('server errors never surface configuration secrets in UI messages', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'secret service_role_key=private' } }), { status: 503 });
  await assert.rejects(requestTributeState('presence'), (error: unknown) => error instanceof Error && !error.message.includes('private') && error.message.includes('temporarily unavailable'));
});

test('a lost write response is reported as unconfirmed so a safe retry remains possible', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(requestTributeState('tribute'), (error: unknown) => error instanceof Error && error.message.includes('couldn’t confirm') && error.message.includes('counted twice'));
});

test('valid duplicate acknowledgement is accepted without claiming a new contribution', async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.method, 'POST');
    return new Response(JSON.stringify({ totalTributes: 12, onlineNow: 2, participated: true, added: false }));
  };
  const result = await requestTributeState('tribute');
  assert.equal(result.added, false);
  assert.equal(result.totalTributes, 12);
});
