import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:5173';
async function call(endpoint: string, cookie?: string) {
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: '{}',
  });
  const data = await response.json();
  assert.equal(response.status, 200, `Unexpected API status ${response.status}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie };
}

const a = await call('presence');
const b = await call('presence');
assert.ok(a.cookie && b.cookie && a.cookie !== b.cookie);
assert.ok(b.data.onlineNow >= 2);
const first = await call('tribute', a.cookie);
assert.equal(first.data.added, true);
const duplicates = await Promise.all(Array.from({ length: 8 }, () => call('tribute', a.cookie)));
assert.ok(duplicates.every(({ data }) => data.added === false && data.totalTributes === first.data.totalTributes));
const second = await call('tribute', b.cookie);
assert.equal(second.data.totalTributes, first.data.totalTributes + 1);
const refreshed = await call('presence', a.cookie);
assert.equal(refreshed.data.participated, true);
assert.equal(refreshed.data.totalTributes, second.data.totalTributes);
const rejected = await fetch(`${origin}/api/tribute`, { method: 'POST', headers: { Origin: 'https://unrelated.example', Cookie: a.cookie } });
assert.equal(rejected.status, 403);
console.log('PASS: two independent HTTP sessions, shared totals, eight concurrent duplicate retries, returning participation, no-store and cross-origin rejection.');

const submission = { name: 'Local test', body: 'A local verification message. Thank you for inspiring generations of builders.', requestId: crypto.randomUUID() };
async function postMessage(cookie: string) {
  const response = await fetch(`${origin}/api/messages`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(submission),
  });
  assert.equal(response.status, 200);
  return response.json();
}
const message = await postMessage(a.cookie!);
assert.equal(message.added, true);
const retries = await Promise.all(Array.from({ length: 5 }, () => postMessage(a.cookie!)));
assert.ok(retries.every(item => item.added === false && item.message.id === message.message.id));
const wallResponse = await fetch(`${origin}/api/messages`, { headers: { Cookie: b.cookie! } });
assert.equal(wallResponse.status, 200);
assert.equal(wallResponse.headers.get('cache-control'), 'no-store');
const wall = await wallResponse.json();
assert.equal(wall.messages.filter((item: { id: string }) => item.id === message.message.id).length, 1);
const blockedPost = await fetch(`${origin}/api/messages`, { method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json', Cookie: a.cookie! }, body: JSON.stringify(submission) });
assert.equal(blockedPost.status, 403);
console.log('PASS: real message POST/GET, five concurrent retries yield one message, second session sees shared wall, cross-origin post rejected.');
