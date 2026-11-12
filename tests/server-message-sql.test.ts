import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { MessageList, MessageResult } from '../server/messages.js';

const hash = (value: number) => value.toString(16).padStart(64, '0');

test('Postgres message migration enforces the public wall contract', async (suite) => {
  const database = new PGlite();
  try {
    await database.exec('create role anon; create role authenticated; create role service_role;');
    await database.exec(await readFile(new URL('../supabase/migrations/202611120001_tribute.sql', import.meta.url), 'utf8'));
    const migration = await readFile(new URL('../supabase/migrations/202611120002_messages.sql', import.meta.url), 'utf8');
    await database.exec(migration);

    async function reset() {
      await database.exec('reset role; truncate public.tribute_messages, public.tribute_message_rate_limits;');
    }
    async function read(limit = 30): Promise<MessageList> {
      const result = await database.query<{ wall: MessageList }>('select public.tribute_messages_read($1) as wall', [limit]);
      return result.rows[0].wall;
    }
    async function post(visitor = hash(1), requestId = randomUUID(), body = 'Thank you for inspiring builders.', name: string | null = null, network = hash(999)): Promise<MessageResult> {
      const result = await database.query<{ result: MessageResult }>(
        'select public.tribute_message_post($1, $2, $3::uuid, $4, $5) as result', [visitor, network, requestId, name, body],
      );
      return result.rows[0].result;
    }

    await suite.test('real posts appear immediately and duplicate requests preserve the original message', async () => {
      await reset();
      assert.deepEqual(await read(), { messages: [], totalMessages: 0 });
      const requestId = randomUUID();
      const replies = await Promise.all(Array.from({ length: 6 }, () => post(hash(1), requestId)));
      assert.equal(replies.filter((reply) => reply.added).length, 1);
      assert.equal(new Set(replies.map((reply) => reply.message.id)).size, 1);
      assert.equal(replies[0].message.name, 'A fellow builder');
      const retry = await post(hash(1), requestId, 'A changed retry must retain the saved original.');
      assert.equal(retry.added, false);
      assert.equal(retry.message.body, 'Thank you for inspiring builders.');
      const wall = await read();
      assert.equal(wall.totalMessages, 1);
      assert.deepEqual(Object.keys(wall.messages[0]).sort(), ['body', 'createdAt', 'id', 'name']);
      const quota = await database.query<{ request_count: number }>("select request_count from public.tribute_message_rate_limits where kind = 'visitor'");
      assert.equal(quota.rows[0].request_count, 1);
    });

    await suite.test('SQL independently rejects invalid, linked, and control-character messages', async () => {
      await reset();
      for (const body of ['', '   ', '\n', 'a'.repeat(241), 'https://spam.example', 'example.com', '<b>markup</b>', 'bad\u0001control']) {
        await assert.rejects(post(hash(1), randomUUID(), body), /INVALID_MESSAGE/);
      }
      await assert.rejects(post(hash(1), randomUUID(), 'Thanks.', 'a'.repeat(33)), /INVALID_MESSAGE/);
      assert.equal((await post(hash(1), randomUUID(), '💚'.repeat(240))).added, true);
      assert.equal((await read()).totalMessages, 1);
    });

    await suite.test('hidden messages leave a tombstone so uncertain retries cannot recreate them', async () => {
      await reset();
      const requestId = randomUUID();
      const removed = await post(hash(1), requestId);
      const visible = await post(hash(2));
      await database.query('update public.tribute_messages set hidden_at = now() where id = $1::uuid', [removed.message.id]);
      await database.exec(migration);

      const wall = await read();
      assert.equal(wall.totalMessages, 1);
      assert.deepEqual(wall.messages.map((message) => message.id), [visible.message.id]);
      assert.equal(JSON.stringify(wall).includes('hidden_at'), false);
      await assert.rejects(post(hash(1), requestId), /MESSAGE_REMOVED/);
      await assert.rejects(post(hash(1), requestId, 'Changing content on the old request cannot restore it.'), /MESSAGE_REMOVED/);

      const rows = await database.query<{ stored: number; hidden: number }>(
        'select count(*)::integer as stored, count(hidden_at)::integer as hidden from public.tribute_messages',
      );
      assert.deepEqual(rows.rows[0], { stored: 2, hidden: 1 });
      const quota = await database.query<{ request_count: number }>(
        "select request_count from public.tribute_message_rate_limits where kind = 'visitor' and rate_key = $1", [hash(1)],
      );
      assert.equal(quota.rows[0].request_count, 1);
      const newDraft = await post(hash(1), randomUUID(), 'A new farewell with a new request.');
      assert.equal(newDraft.added, true);
      assert.equal(newDraft.totalMessages, 2);
      assert.equal((await read()).messages.some((message) => message.id === removed.message.id), false);
    });

    await suite.test('visitor rate limits allow free retries and block the fourth new message', async () => {
      await reset();
      const requestId = randomUUID();
      await post(hash(1), requestId);
      await post(hash(1));
      await post(hash(1));
      await assert.rejects(post(hash(1)), /RATE_LIMITED/);
      assert.equal((await post(hash(1), requestId)).added, false);
      assert.equal((await read()).totalMessages, 3);
    });

    await suite.test('network quota failure rolls back the visitor quota and message insertion', async () => {
      await reset();
      const network = hash(999);
      await database.query(`insert into public.tribute_message_rate_limits (kind, rate_key, window_start, request_count)
        values ('network', $1, date_trunc('minute', now()), 20)`, [network]);
      await assert.rejects(post(hash(1), randomUUID(), 'Thanks.', null, network), /RATE_LIMITED/);
      assert.equal((await read()).totalMessages, 0);
      const quotas = await database.query<{ count: number }>("select count(*)::integer as count from public.tribute_message_rate_limits where kind = 'visitor'");
      assert.equal(quotas.rows[0].count, 0);
      assert.equal((await post(hash(1), randomUUID(), 'Thanks.', null, hash(998))).added, true);
    });

    await suite.test('reads return the newest thirty without exposing private identifiers', async () => {
      await reset();
      for (let i = 0; i < 35; i += 1) {
        await database.query(`insert into public.tribute_messages (visitor_hash, request_id, name, body, created_at)
          values ($1, $2::uuid, 'A builder', $3, now() - ($4::integer * interval '1 second'))`,
        [hash(i + 1), randomUUID(), `Farewell ${i}`, i]);
      }
      const wall = await read(1000);
      assert.equal(wall.messages.length, 30);
      assert.equal(wall.totalMessages, 35);
      assert.equal(wall.messages[0].body, 'Farewell 0');
      assert.equal(wall.messages[29].body, 'Farewell 29');
      assert.equal(JSON.stringify(wall).includes('visitor_hash'), false);
      assert.equal(JSON.stringify(wall).includes('request_id'), false);
    });

    await suite.test('only service-role RPCs can read or write messages', async () => {
      await reset();
      for (const role of ['anon', 'authenticated']) {
        await database.exec(`set role ${role}`);
        try {
          await assert.rejects(database.query('select * from public.tribute_messages'), /permission denied/);
          await assert.rejects(database.query('select * from public.tribute_message_rate_limits'), /permission denied/);
          await assert.rejects(read(), /permission denied/);
          await assert.rejects(post(), /permission denied/);
        } finally {
          await database.exec('reset role');
        }
      }
      await database.exec('set role service_role');
      try {
        assert.equal((await post()).added, true);
        assert.equal((await read()).totalMessages, 1);
      } finally {
        await database.exec('reset role');
      }
      await database.exec(migration);
      assert.equal((await read()).totalMessages, 1);
    });
  } finally {
    await database.close();
  }
});
