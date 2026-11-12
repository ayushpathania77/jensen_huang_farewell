-- Public farewell wall. Run after 202611120001_tribute.sql.
-- Messages are plain text and become visible immediately; these filters are
-- basic spam controls, not human moderation or an abuse-classification system.

create table if not exists public.tribute_messages (
  id uuid primary key default gen_random_uuid(),
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  request_id uuid not null,
  name text not null check (char_length(name) between 1 and 32),
  body text not null check (char_length(body) between 1 and 240),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  unique (visitor_hash, request_id)
);
-- Preserve existing message/request identities when applying this revision to
-- an earlier local schema. Operators hide a reviewed row instead of deleting it.
alter table public.tribute_messages add column if not exists hidden_at timestamptz;
create index if not exists tribute_messages_recent_idx on public.tribute_messages (created_at desc, id desc);
create index if not exists tribute_messages_visible_recent_idx
  on public.tribute_messages (created_at desc, id desc) where hidden_at is null;

create table if not exists public.tribute_message_rate_limits (
  kind text not null check (kind in ('visitor', 'network')),
  rate_key text not null check (rate_key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (kind, rate_key, window_start)
);
create index if not exists tribute_message_rate_window_idx on public.tribute_message_rate_limits (window_start);

alter table public.tribute_messages enable row level security;
alter table public.tribute_message_rate_limits enable row level security;
revoke all on public.tribute_messages, public.tribute_message_rate_limits from public, anon, authenticated;

create or replace function public.tribute_messages_read(p_limit integer default 30)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'body', m.body, 'createdAt', m.created_at)
        order by m.created_at desc, m.id desc)
      from (select id, name, body, created_at from public.tribute_messages where hidden_at is null
        order by created_at desc, id desc limit least(30, greatest(1, coalesce(p_limit, 30)))) m
    ), '[]'::jsonb),
    'totalMessages', (select count(*) from public.tribute_messages where hidden_at is null)
  );
$$;

create or replace function public.tribute_message_post(
  p_visitor_hash text, p_rate_key text, p_request_id uuid, p_name text, p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(nullif(btrim(p_name), ''), 'A fellow builder');
  v_body text := btrim(p_body);
  v_message public.tribute_messages%rowtype;
  v_total bigint;
  v_count integer;
  v_visitor_window timestamptz := date_bin(interval '10 minutes', now(), timestamptz '2000-01-01 00:00:00+00');
  v_network_window timestamptz := date_trunc('minute', now());
  v_retry integer;
  v_link_pattern text := '(?i)(https?://|www[.]|[a-z0-9-]+[.](com|net|org|io|dev|app|co|ai|xyz)([^a-z]|$))';
begin
  if p_request_id is null or p_visitor_hash is null or p_visitor_hash !~ '^[0-9a-f]{64}$'
    or p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$'
    or v_body is null or char_length(v_body) not between 1 and 240
    or regexp_replace(v_body, '[[:space:]]', '', 'g') = ''
    or char_length(v_name) not between 1 and 32
    or regexp_replace(v_body, E'\n', '', 'g') ~ '[[:cntrl:]]'
    or v_name ~ '[[:cntrl:]]'
    or v_body ~ v_link_pattern or v_name ~ v_link_pattern
    or v_body ~* '<[/]?[[:alpha:]][^>]*>' or v_name ~* '<[/]?[[:alpha:]][^>]*>' then
    raise exception using errcode = 'P0001', message = 'INVALID_MESSAGE';
  end if;

  -- Serialize submissions from this browser so simultaneous retries never
  -- consume additional quota or insert twice, even across server instances.
  perform pg_advisory_xact_lock(hashtextextended('message:' || p_visitor_hash, 0));
  select * into v_message from public.tribute_messages
    where visitor_hash = p_visitor_hash and request_id = p_request_id;
  if found then
    if v_message.hidden_at is not null then
      raise exception using errcode = 'P0001', message = 'MESSAGE_REMOVED';
    end if;
    select count(*) into v_total from public.tribute_messages where hidden_at is null;
    return jsonb_build_object('message', jsonb_build_object('id', v_message.id, 'name', v_message.name,
      'body', v_message.body, 'createdAt', v_message.created_at), 'added', false, 'totalMessages', v_total);
  end if;

  delete from public.tribute_message_rate_limits where window_start < now() - interval '1 day';
  insert into public.tribute_message_rate_limits (kind, rate_key, window_start, request_count)
  values ('visitor', p_visitor_hash, v_visitor_window, 1)
  on conflict (kind, rate_key, window_start)
  do update set request_count = public.tribute_message_rate_limits.request_count + 1
  returning request_count into v_count;
  if v_count > 3 then
    v_retry := greatest(1, ceil(extract(epoch from v_visitor_window + interval '10 minutes' - now()))::integer);
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED', detail = v_retry::text;
  end if;

  insert into public.tribute_message_rate_limits (kind, rate_key, window_start, request_count)
  values ('network', p_rate_key, v_network_window, 1)
  on conflict (kind, rate_key, window_start)
  do update set request_count = public.tribute_message_rate_limits.request_count + 1
  returning request_count into v_count;
  if v_count > 20 then
    v_retry := greatest(1, ceil(extract(epoch from v_network_window + interval '1 minute' - now()))::integer);
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED', detail = v_retry::text;
  end if;

  insert into public.tribute_messages (visitor_hash, request_id, name, body)
  values (p_visitor_hash, p_request_id, v_name, v_body) returning * into v_message;
  select count(*) into v_total from public.tribute_messages where hidden_at is null;
  return jsonb_build_object('message', jsonb_build_object('id', v_message.id, 'name', v_message.name,
    'body', v_message.body, 'createdAt', v_message.created_at), 'added', true, 'totalMessages', v_total);
end;
$$;

revoke all on function public.tribute_messages_read(integer) from public, anon, authenticated;
revoke all on function public.tribute_message_post(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.tribute_messages_read(integer) to service_role;
grant execute on function public.tribute_message_post(text, text, uuid, text, text) to service_role;

comment on table public.tribute_messages is 'Public plain-text farewell messages; hidden_at removes a message from public reads while retaining browser/request uniqueness for safe retries.';
comment on table public.tribute_message_rate_limits is 'Fixed windows: three messages per browser per ten minutes, twenty per hashed network per minute.';
