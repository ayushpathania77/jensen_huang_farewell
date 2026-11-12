import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

interface State {
  totalTributes: number;
  onlineNow: number;
  participated: boolean;
  added?: boolean;
}

const identity = (value: number) => value.toString(16).padStart(64, '0');

test('Postgres migration executes and enforces the production RPC contract', async (suite) => {
  const database = new PGlite();
  try {
    await database.exec('create role anon; create role authenticated; create role service_role;');
    const migration = await readFile(new URL('../supabase/migrations/202611120001_tribute.sql', import.meta.url), 'utf8');
    await database.exec(migration);

    async function reset() {
      await database.exec(`
        reset role;
        truncate public.tribute_participants, public.tribute_presence, public.tribute_rate_limits;
        update public.tribute_totals set total_tributes = 0 where singleton = true;
      `);
    }

    async function rpc(name: 'tribute_touch' | 'tribute_join', visitor: string, rate = identity(999)): Promise<State> {
      const result = await database.query<{ state: State }>(
        `select public.${name}($1, $2) as state`, [visitor, rate],
      );
      return result.rows[0].state;
    }

    await suite.test('touch and join return real shared, durable, idempotent totals', async () => {
      await reset();
      assert.deepEqual(await rpc('tribute_touch', identity(1)), {
        totalTributes: 0, onlineNow: 1, participated: false,
      });
      assert.deepEqual(await rpc('tribute_join', identity(1)), {
        totalTributes: 1, onlineNow: 1, participated: true, added: true,
      });
      assert.deepEqual(await rpc('tribute_join', identity(1)), {
        totalTributes: 1, onlineNow: 1, participated: true, added: false,
      });
      assert.equal((await rpc('tribute_join', identity(2))).totalTributes, 2);
      assert.equal((await rpc('tribute_touch', identity(1))).participated, true);
      assert.equal((await rpc('tribute_touch', identity(3))).participated, false);
      const rows = await database.query<{ count: number }>('select count(*)::integer as count from public.tribute_participants');
      assert.equal(rows.rows[0].count, 2);
    });

    await suite.test('simultaneously queued duplicate calls only insert once', async () => {
      await reset();
      const duplicates = await Promise.all(Array.from({ length: 12 }, () => rpc('tribute_join', identity(1))));
      assert.equal(duplicates.filter((state) => state.added).length, 1);
      const distinct = await Promise.all(Array.from({ length: 12 }, (_, i) => rpc('tribute_join', identity(i + 2))));
      assert.equal(distinct.filter((state) => state.added).length, 12);
      assert.equal((await rpc('tribute_touch', identity(100))).totalTributes, 13);
    });

    await suite.test('presence deduplicates tabs and excludes activity older than 90 seconds', async () => {
      await reset();
      await rpc('tribute_touch', identity(1));
      assert.equal((await rpc('tribute_touch', identity(1))).onlineNow, 1);
      await database.query("update public.tribute_presence set last_seen_at = now() - interval '91 seconds' where visitor_hash = $1", [identity(1)]);
      assert.equal((await rpc('tribute_touch', identity(2))).onlineNow, 1);
      assert.equal((await rpc('tribute_touch', identity(1))).onlineNow, 2);
    });

    await suite.test('shared SQL rate limits reject excess contributions without incrementing totals', async () => {
      await reset();
      const network = identity(800);
      await database.query(`
        insert into public.tribute_rate_limits (action, rate_key, window_start, request_count)
        values ('tribute', $1, date_trunc('minute', now()), 60)
      `, [network]);
      await assert.rejects(rpc('tribute_join', identity(1), network), /RATE_LIMITED/);
      const state = await rpc('tribute_touch', identity(1), network);
      assert.equal(state.totalTributes, 0);
      assert.equal(state.participated, false);
      const buckets = await database.query<{ request_count: number }>(
        "select request_count from public.tribute_rate_limits where action = 'tribute' and rate_key = $1", [network],
      );
      assert.equal(buckets.rows[0].request_count, 60);
      assert.equal((await rpc('tribute_join', identity(2), identity(801))).added, true);
    });

    await suite.test('anonymous and authenticated clients cannot access tables or execute RPCs', async () => {
      await reset();
      for (const role of ['anon', 'authenticated']) {
        await database.exec(`set role ${role};`);
        try {
          await assert.rejects(database.query('select * from public.tribute_totals'), /permission denied/);
          await assert.rejects(database.query('select * from public.tribute_participants'), /permission denied/);
          await assert.rejects(rpc('tribute_touch', identity(1)), /permission denied/);
          await assert.rejects(rpc('tribute_join', identity(1)), /permission denied/);
        } finally {
          await database.exec('reset role;');
        }
      }
      await database.exec('set role service_role;');
      try {
        assert.equal((await rpc('tribute_join', identity(1))).added, true);
        assert.equal((await rpc('tribute_touch', identity(1))).totalTributes, 1);
      } finally {
        await database.exec('reset role;');
      }
    });

    await suite.test('migration can run again without destroying contributions', async () => {
      const before = await rpc('tribute_touch', identity(1));
      await database.exec(migration);
      const after = await rpc('tribute_touch', identity(1));
      assert.equal(after.totalTributes, before.totalTributes);
      assert.equal(after.participated, before.participated);
    });
  } finally {
    await database.close();
  }
});
