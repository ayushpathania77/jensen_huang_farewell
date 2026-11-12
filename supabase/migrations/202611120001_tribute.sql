-- Run once through the Supabase SQL editor or `supabase db push`.
-- Browser clients have no table access. Only server-held service_role credentials
-- may execute the two public RPCs below.

create table if not exists public.tribute_participants (
  visitor_hash text primary key check (visitor_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.tribute_presence (
  visitor_hash text primary key check (visitor_hash ~ '^[0-9a-f]{64}$'),
  last_seen_at timestamptz not null default now()
);
create index if not exists tribute_presence_seen_idx on public.tribute_presence (last_seen_at);

create table if not exists public.tribute_totals (
  singleton boolean primary key default true check (singleton),
  total_tributes bigint not null default 0 check (total_tributes >= 0)
);
insert into public.tribute_totals (singleton, total_tributes) values (true, 0)
on conflict (singleton) do nothing;

create table if not exists public.tribute_rate_limits (
  action text not null check (action in ('presence', 'tribute')),
  rate_key text not null check (rate_key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (action, rate_key, window_start)
);
create index if not exists tribute_rate_limits_window_idx on public.tribute_rate_limits (window_start);

alter table public.tribute_participants enable row level security;
alter table public.tribute_presence enable row level security;
alter table public.tribute_totals enable row level security;
alter table public.tribute_rate_limits enable row level security;
revoke all on public.tribute_participants, public.tribute_presence,
  public.tribute_totals, public.tribute_rate_limits from public, anon, authenticated;

create or replace function public.tribute_check_rate(p_action text, p_rate_key text, p_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_requests integer;
  v_retry integer;
begin
  -- Keep only short-lived, hashed network metadata. This cleanup needs no cron.
  delete from public.tribute_rate_limits where window_start < now() - interval '1 day';
  insert into public.tribute_rate_limits (action, rate_key, window_start, request_count)
  values (p_action, p_rate_key, v_window, 1)
  on conflict (action, rate_key, window_start)
  do update set request_count = public.tribute_rate_limits.request_count + 1
  returning request_count into v_requests;

  if v_requests > p_limit then
    v_retry := greatest(1, ceil(extract(epoch from v_window + interval '1 minute' - now()))::integer);
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED', detail = v_retry::text;
  end if;
end;
$$;

create or replace function public.tribute_touch(p_visitor_hash text, p_rate_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_online bigint;
  v_participated boolean;
begin
  perform public.tribute_check_rate('presence', p_rate_key, 600);
  insert into public.tribute_presence (visitor_hash, last_seen_at)
  values (p_visitor_hash, now())
  on conflict (visitor_hash) do update set last_seen_at = excluded.last_seen_at;

  delete from public.tribute_presence where last_seen_at < now() - interval '1 day';
  select total_tributes into v_total from public.tribute_totals where singleton = true;
  select count(*) into v_online from public.tribute_presence
    where last_seen_at > now() - interval '90 seconds';
  select exists(select 1 from public.tribute_participants where visitor_hash = p_visitor_hash)
    into v_participated;

  return jsonb_build_object('totalTributes', v_total, 'onlineNow', v_online, 'participated', v_participated);
end;
$$;

create or replace function public.tribute_join(p_visitor_hash text, p_rate_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_total bigint;
  v_online bigint;
begin
  perform public.tribute_check_rate('tribute', p_rate_key, 60);

  -- The unique key and aggregate update share one transaction. Concurrent
  -- requests and retries can never count the same browser twice.
  insert into public.tribute_participants (visitor_hash) values (p_visitor_hash)
  on conflict (visitor_hash) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.tribute_totals set total_tributes = total_tributes + 1
    where singleton = true returning total_tributes into v_total;
  else
    select total_tributes into v_total from public.tribute_totals where singleton = true;
  end if;

  insert into public.tribute_presence (visitor_hash, last_seen_at)
  values (p_visitor_hash, now())
  on conflict (visitor_hash) do update set last_seen_at = excluded.last_seen_at;
  delete from public.tribute_presence where last_seen_at < now() - interval '1 day';
  select count(*) into v_online from public.tribute_presence
    where last_seen_at > now() - interval '90 seconds';

  return jsonb_build_object('totalTributes', v_total, 'onlineNow', v_online,
    'participated', true, 'added', v_inserted = 1);
end;
$$;

revoke all on function public.tribute_check_rate(text, text, integer) from public, anon, authenticated;
revoke all on function public.tribute_touch(text, text) from public, anon, authenticated;
revoke all on function public.tribute_join(text, text) from public, anon, authenticated;
grant execute on function public.tribute_touch(text, text) to service_role;
grant execute on function public.tribute_join(text, text) to service_role;

comment on table public.tribute_participants is 'One anonymous tribute per signed browser session; no names or emails.';
comment on table public.tribute_presence is 'Server timestamps for an approximate 90-second active-browser window.';
comment on table public.tribute_rate_limits is 'One-minute request buckets keyed by HMAC of network address; records older than a day are pruned on the next request.';
