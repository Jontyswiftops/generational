-- Generational schema. Applied to Supabase via MCP migrations; this file is
-- the reference copy.
--
-- Model: exactly one round table. Members are the only readers; writes are
-- plain inserts under RLS for authored content, and SECURITY DEFINER RPCs for
-- anything that touches membership, sessions, or cross-user read models.

-- ============================================================
-- Tables
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New member'
    check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.round_table (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Generational' check (char_length(btrim(name)) between 1 and 60),
  host_id uuid references auth.users(id) on delete set null,
  invite_code text unique,
  singleton boolean not null default true unique check (singleton),
  created_at timestamptz not null default now()
);
alter table public.round_table enable row level security;
insert into public.round_table (name) values ('Generational');

create table public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('host', 'member')),
  joined_at timestamptz not null default now()
);
alter table public.members enable row level security;

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  category text not null check (category in ('business', 'property', 'shares', 'crypto', 'side_hustle')),
  pitch text not null check (char_length(pitch) between 1 and 4000),
  link text check (char_length(link) <= 500),
  ask text check (char_length(ask) <= 300),
  status text not null default 'open' check (status in ('open', 'in_motion', 'parked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ideas enable row level security;

create table public.idea_stances (
  idea_id uuid not null references public.ideas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stance text not null check (stance in ('in', 'keen', 'challenge')),
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
alter table public.idea_stances enable row level security;

-- Shared by ideas and posts. One nesting level (parent_id set = reply).
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('idea', 'post')),
  target_id uuid not null,
  parent_id uuid references public.comments(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.comments enable row level security;
create index comments_target_idx on public.comments (target_type, target_id, created_at);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  starts_at timestamptz not null,
  meet_link text check (char_length(meet_link) <= 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'done')),
  notes text not null default '' check (char_length(notes) <= 20000),
  notes_by uuid references auth.users(id) on delete set null,
  notes_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sessions enable row level security;

create table public.agenda_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  position integer not null default 0,
  text text not null check (char_length(btrim(text)) between 1 and 300),
  done boolean not null default false,
  done_by uuid references auth.users(id) on delete set null
);
alter table public.agenda_items enable row level security;
create index agenda_session_idx on public.agenda_items (session_id, position);

create table public.rsvps (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table public.rsvps enable row level security;

create table public.session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.session_messages enable row level security;
create index session_messages_idx on public.session_messages (session_id, created_at);

create table public.session_attendance (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
alter table public.session_attendance enable row level security;

create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  assignee_id uuid references auth.users(id) on delete set null,
  text text not null check (char_length(btrim(text)) between 1 and 300),
  done boolean not null default false,
  due_on date,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.action_items enable row level security;
create index action_items_session_idx on public.action_items (session_id, created_at);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('win', 'milestone', 'goal')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.posts enable row level security;

create table public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('fire', 'clap', 'rocket', 'hundred')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);
alter table public.reactions enable row level security;

create table public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('economy', 'property', 'shares', 'crypto', 'business')),
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.channel_messages enable row level security;
create index channel_messages_idx on public.channel_messages (channel, created_at desc);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  shared_by uuid not null references auth.users(id) on delete cascade,
  url text not null check (char_length(url) between 1 and 500),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  type text not null check (type in ('book', 'podcast', 'article', 'video')),
  take text check (char_length(take) <= 600),
  created_at timestamptz not null default now()
);
alter table public.resources enable row level security;

-- ============================================================
-- Helper functions
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger ideas_touch before update on public.ideas
  for each row execute function public.set_updated_at();
create trigger rsvps_touch before update on public.rsvps
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
             split_part(coalesce(new.email, 'New member'), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_member(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = uid);
$$;

create or replace function public.is_host()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid() and role = 'host');
$$;

create or replace function public.gen_invite_code()
returns text language sql volatile set search_path = public as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random() * 31) + 1)::int, 1),
    ''
  ) from generate_series(1, 6);
$$;

-- Consecutive finished sessions attended, counting back from the latest.
create or replace function public.attendance_streak(uid uuid)
returns integer language sql stable set search_path = public as $$
  with ranked as (
    select exists (
             select 1 from session_attendance sa
             where sa.session_id = s.id and sa.user_id = uid) as went,
           row_number() over (order by s.starts_at desc) as rn
    from sessions s where s.status = 'done'
  ),
  firstmiss as (select min(rn) as m from ranked where not went)
  select count(*)::int from ranked, firstmiss
  where went and (firstmiss.m is null or rn < firstmiss.m);
$$;

-- ============================================================
-- Membership RPCs
-- ============================================================

create or replace function public.table_status()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  t round_table;
  m members;
  cnt integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into t from round_table limit 1;
  select * into m from members where user_id = auth.uid();
  select count(*) into cnt from members;
  return json_build_object(
    'name', t.name,
    'host_claimed', t.host_id is not null,
    'is_member', m.user_id is not null,
    'is_host', coalesce(m.role = 'host', false),
    'member_count', cnt,
    'invite_code', case when m.role = 'host' then t.invite_code end
  );
end $$;

create or replace function public.claim_host()
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  t round_table;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into t from round_table limit 1 for update;
  if t.host_id is not null then
    raise exception 'The host seat is already taken';
  end if;
  loop
    begin
      update round_table set host_id = auth.uid(), invite_code = public.gen_invite_code()
      where id = t.id;
      exit;
    exception when unique_violation then
      -- rare invite-code collision; try another
    end;
  end loop;
  insert into members (user_id, role) values (auth.uid(), 'host')
  on conflict (user_id) do update set role = 'host';
  return public.table_status();
end $$;

create or replace function public.join_table(code text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  t round_table;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into t from round_table where invite_code = upper(btrim(code));
  if not found then
    raise exception 'That invite code is not valid';
  end if;
  insert into members (user_id) values (auth.uid())
  on conflict (user_id) do nothing;
  return public.table_status();
end $$;

create or replace function public.rotate_invite_code()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  c text;
begin
  if not public.is_host() then
    raise exception 'Only the host can do that';
  end if;
  loop
    begin
      c := public.gen_invite_code();
      update round_table set invite_code = c;
      exit;
    exception when unique_violation then
    end;
  end loop;
  return c;
end $$;

create or replace function public.remove_member(uid uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_host() then
    raise exception 'Only the host can do that';
  end if;
  if uid = auth.uid() then
    raise exception 'The host cannot remove themselves';
  end if;
  delete from members where user_id = uid;
end $$;

create or replace function public.leave_table()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if public.is_host() then
    raise exception 'The host cannot leave the table';
  end if;
  delete from members where user_id = auth.uid();
end $$;

create or replace function public.rename_table(p_name text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_host() then
    raise exception 'Only the host can do that';
  end if;
  update round_table set name = btrim(p_name);
end $$;

create or replace function public.table_members()
returns table (
  user_id uuid,
  display_name text,
  role text,
  points integer,
  streak integer,
  last_active_at timestamptz,
  is_self boolean,
  joined_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  return query
  select
    m.user_id,
    p.display_name,
    m.role,
    (coalesce(a.n, 0) * 5 + coalesce(i.n, 0) * 3 + coalesce(po.n, 0) * 2
      + coalesce(c.n, 0) + coalesce(st.n, 0) + coalesce(r.n, 0))::int,
    public.attendance_streak(m.user_id),
    greatest(i.t, po.t, c.t, sm.t, cm.t, a.t),
    (m.user_id = auth.uid()),
    m.joined_at
  from members m
  join profiles p on p.id = m.user_id
  left join lateral (select count(*) n, max(x.joined_at) t from session_attendance x where x.user_id = m.user_id) a on true
  left join lateral (select count(*) n, max(x.created_at) t from ideas x where x.author_id = m.user_id) i on true
  left join lateral (select count(*) n, max(x.created_at) t from posts x where x.author_id = m.user_id) po on true
  left join lateral (select count(*) n, max(x.created_at) t from comments x where x.author_id = m.user_id) c on true
  left join lateral (select count(*) n from idea_stances x where x.user_id = m.user_id) st on true
  left join lateral (select count(*) n from reactions x where x.user_id = m.user_id) r on true
  left join lateral (select max(x.created_at) t from session_messages x where x.author_id = m.user_id) sm on true
  left join lateral (select max(x.created_at) t from channel_messages x where x.author_id = m.user_id) cm on true
  order by 4 desc, p.display_name;
end $$;

-- ============================================================
-- Ideas
-- ============================================================

create or replace function public.list_ideas(p_status text default null)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  return coalesce((
    select json_agg(row_to_json(x)) from (
      select i.id, i.title, i.category, i.pitch, i.link, i.ask, i.status, i.created_at, i.author_id,
        p.display_name as author,
        (select count(*) from idea_stances s where s.idea_id = i.id and s.stance = 'in')::int as in_count,
        (select count(*) from idea_stances s where s.idea_id = i.id and s.stance = 'keen')::int as keen_count,
        (select count(*) from idea_stances s where s.idea_id = i.id and s.stance = 'challenge')::int as challenge_count,
        (select s.stance from idea_stances s where s.idea_id = i.id and s.user_id = auth.uid()) as my_stance,
        (select count(*) from comments c where c.target_type = 'idea' and c.target_id = i.id)::int as comment_count
      from ideas i
      join profiles p on p.id = i.author_id
      where p_status is null or i.status = p_status
      order by i.created_at desc
    ) x), '[]'::json);
end $$;

create or replace function public.idea_detail(p_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  result json;
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  select json_build_object(
    'id', i.id, 'title', i.title, 'category', i.category, 'pitch', i.pitch, 'link', i.link,
    'ask', i.ask, 'status', i.status, 'created_at', i.created_at, 'author_id', i.author_id,
    'author', p.display_name,
    'my_stance', (select s.stance from idea_stances s where s.idea_id = i.id and s.user_id = auth.uid()),
    'stances', coalesce((select json_agg(json_build_object(
        'user_id', s.user_id, 'display_name', sp.display_name, 'stance', s.stance)
        order by s.created_at)
      from idea_stances s join profiles sp on sp.id = s.user_id where s.idea_id = i.id), '[]'::json),
    'comments', coalesce((select json_agg(json_build_object(
        'id', c.id, 'parent_id', c.parent_id, 'author_id', c.author_id, 'author', cp.display_name,
        'body', c.body, 'created_at', c.created_at) order by c.created_at)
      from comments c join profiles cp on cp.id = c.author_id
      where c.target_type = 'idea' and c.target_id = i.id), '[]'::json)
  ) into result
  from ideas i join profiles p on p.id = i.author_id
  where i.id = p_id;
  if result is null then
    raise exception 'Idea not found';
  end if;
  return result;
end $$;

-- ============================================================
-- Sessions
-- ============================================================

create or replace function public.list_sessions()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  return coalesce((
    select json_agg(row_to_json(x)) from (
      select s.id, s.title, s.starts_at, s.meet_link, s.status, s.host_id, p.display_name as host,
        (select count(*) from agenda_items a where a.session_id = s.id)::int as agenda_count,
        (select count(*) from rsvps r where r.session_id = s.id and r.status = 'yes')::int as yes_count,
        (select r.status from rsvps r where r.session_id = s.id and r.user_id = auth.uid()) as my_rsvp,
        (select count(*) from session_attendance a where a.session_id = s.id)::int as attended_count,
        (select count(*) from action_items a where a.session_id = s.id and not a.done)::int as open_actions
      from sessions s join profiles p on p.id = s.host_id
      order by s.starts_at desc
    ) x), '[]'::json);
end $$;

create or replace function public.session_detail(p_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  result json;
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  select json_build_object(
    'id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'meet_link', s.meet_link,
    'status', s.status, 'host_id', s.host_id, 'host', p.display_name,
    'notes', s.notes, 'notes_at', s.notes_at,
    'notes_by', (select np.display_name from profiles np where np.id = s.notes_by),
    'my_rsvp', (select r.status from rsvps r where r.session_id = s.id and r.user_id = auth.uid()),
    'attended', exists (select 1 from session_attendance a where a.session_id = s.id and a.user_id = auth.uid()),
    'agenda', coalesce((select json_agg(json_build_object(
        'id', a.id, 'position', a.position, 'text', a.text, 'done', a.done,
        'done_by', (select dp.display_name from profiles dp where dp.id = a.done_by))
        order by a.position)
      from agenda_items a where a.session_id = s.id), '[]'::json),
    'rsvps', coalesce((select json_agg(json_build_object(
        'user_id', r.user_id, 'display_name', rp.display_name, 'status', r.status) order by rp.display_name)
      from rsvps r join profiles rp on rp.id = r.user_id where r.session_id = s.id), '[]'::json),
    'attendance', coalesce((select json_agg(json_build_object(
        'user_id', a.user_id, 'display_name', ap.display_name) order by a.joined_at)
      from session_attendance a join profiles ap on ap.id = a.user_id where a.session_id = s.id), '[]'::json),
    'action_items', coalesce((select json_agg(json_build_object(
        'id', ai.id, 'text', ai.text, 'assignee_id', ai.assignee_id,
        'assignee', (select xp.display_name from profiles xp where xp.id = ai.assignee_id),
        'done', ai.done, 'due_on', ai.due_on, 'created_by', ai.created_by) order by ai.created_at)
      from action_items ai where ai.session_id = s.id), '[]'::json),
    'messages', coalesce((select json_agg(m order by m.created_at) from (
        select sm.id, sm.author_id, mp.display_name as author, sm.body, sm.created_at
        from session_messages sm join profiles mp on mp.id = sm.author_id
        where sm.session_id = s.id
        order by sm.created_at desc limit 200) m), '[]'::json)
  ) into result
  from sessions s join profiles p on p.id = s.host_id
  where s.id = p_id;
  if result is null then
    raise exception 'Session not found';
  end if;
  return result;
end $$;

create or replace function public.create_session(
  p_title text, p_starts_at timestamptz, p_meet_link text default null, p_agenda text[] default '{}'
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  sid uuid;
  item text;
  pos integer := 0;
begin
  if not public.is_host() then
    raise exception 'Only the host can schedule a session';
  end if;
  insert into sessions (host_id, title, starts_at, meet_link)
  values (auth.uid(), btrim(p_title), p_starts_at, nullif(btrim(coalesce(p_meet_link, '')), ''))
  returning id into sid;
  foreach item in array coalesce(p_agenda, '{}') loop
    if btrim(item) <> '' then
      insert into agenda_items (session_id, position, text) values (sid, pos, btrim(item));
      pos := pos + 1;
    end if;
  end loop;
  return sid;
end $$;

create or replace function public.update_session(
  p_id uuid, p_title text, p_starts_at timestamptz, p_meet_link text default null, p_agenda text[] default null
) returns void language plpgsql volatile security definer set search_path = public as $$
declare
  item text;
  pos integer := 0;
begin
  if not public.is_host() then
    raise exception 'Only the host can edit a session';
  end if;
  update sessions set title = btrim(p_title), starts_at = p_starts_at,
    meet_link = nullif(btrim(coalesce(p_meet_link, '')), '')
  where id = p_id;
  if p_agenda is not null then
    delete from agenda_items where session_id = p_id;
    foreach item in array p_agenda loop
      if btrim(item) <> '' then
        insert into agenda_items (session_id, position, text) values (p_id, pos, btrim(item));
        pos := pos + 1;
      end if;
    end loop;
  end if;
end $$;

create or replace function public.set_session_status(p_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_host() then
    raise exception 'Only the host can change a session';
  end if;
  update sessions set status = p_status where id = p_id;
end $$;

create or replace function public.delete_session(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_host() then
    raise exception 'Only the host can delete a session';
  end if;
  delete from sessions where id = p_id;
end $$;

create or replace function public.save_session_notes(p_id uuid, p_notes text)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare
  ts timestamptz := now();
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  update sessions set notes = coalesce(p_notes, ''), notes_by = auth.uid(), notes_at = ts
  where id = p_id;
  return ts;
end $$;

-- Attendance counts while the room is open: from 30 minutes before the
-- start until 4 hours after, or whenever the host has flagged it live.
create or replace function public.mark_attendance(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  select * into s from sessions where id = p_id;
  if not found then
    raise exception 'Session not found';
  end if;
  if s.status = 'live' or (s.status = 'scheduled'
      and now() between s.starts_at - interval '30 minutes' and s.starts_at + interval '4 hours') then
    insert into session_attendance (session_id, user_id) values (p_id, auth.uid())
    on conflict do nothing;
    return true;
  end if;
  return false;
end $$;

-- ============================================================
-- Feed, talk, resources
-- ============================================================

create or replace function public.feed(lim integer default 40)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  return coalesce((
    select json_agg(row_to_json(x)) from (
      select po.id, po.kind, po.body, po.created_at, po.author_id, p.display_name as author,
        (select coalesce(json_object_agg(e, n), '{}'::json) from (
          select r.emoji e, count(*) n from reactions r where r.post_id = po.id group by r.emoji) t) as reactions,
        coalesce((select json_agg(r.emoji) from reactions r where r.post_id = po.id and r.user_id = auth.uid()), '[]'::json) as my_reactions,
        coalesce((select json_agg(json_build_object(
            'id', c.id, 'parent_id', c.parent_id, 'author_id', c.author_id, 'author', cp.display_name,
            'body', c.body, 'created_at', c.created_at) order by c.created_at)
          from comments c join profiles cp on cp.id = c.author_id
          where c.target_type = 'post' and c.target_id = po.id), '[]'::json) as comments
      from posts po join profiles p on p.id = po.author_id
      order by po.created_at desc
      limit greatest(1, least(lim, 200))
    ) x), '[]'::json);
end $$;

create or replace function public.channel_feed(p_channel text, before timestamptz default null, lim integer default 60)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  return coalesce((
    select json_agg(row_to_json(x) order by x.created_at) from (
      select m.id, m.author_id, p.display_name as author, m.body, m.created_at
      from channel_messages m join profiles p on p.id = m.author_id
      where m.channel = p_channel and (before is null or m.created_at < before)
      order by m.created_at desc
      limit greatest(1, least(lim, 200))
    ) x), '[]'::json);
end $$;

create or replace function public.list_resources()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(auth.uid()) then
    raise exception 'Not a member';
  end if;
  return coalesce((
    select json_agg(row_to_json(x)) from (
      select r.id, r.url, r.title, r.type, r.take, r.created_at, r.shared_by, p.display_name as sharer
      from resources r join profiles p on p.id = r.shared_by
      order by r.created_at desc
    ) x), '[]'::json);
end $$;

-- ============================================================
-- RLS policies
-- ============================================================

create policy "profiles: self or fellow member reads" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (public.is_member(auth.uid()) and public.is_member(id)));
create policy "profiles: self updates" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members: members read" on public.members
  for select to authenticated using (public.is_member(auth.uid()));

-- Authored content: members read; authors insert; author or host edit/delete.
do $$
declare
  t record;
begin
  for t in select * from (values
    ('ideas', 'author_id'), ('idea_stances', 'user_id'), ('comments', 'author_id'),
    ('rsvps', 'user_id'), ('session_messages', 'author_id'), ('posts', 'author_id'),
    ('reactions', 'user_id'), ('channel_messages', 'author_id'), ('resources', 'shared_by'),
    ('action_items', 'created_by')
  ) as v(tbl, col) loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(auth.uid()))',
      t.tbl || ': members read', t.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (%I = auth.uid() and public.is_member(auth.uid()))',
      t.tbl || ': author inserts', t.tbl, t.col);
    execute format('create policy %I on public.%I for update to authenticated using (%I = auth.uid() or public.is_host()) with check (public.is_member(auth.uid()))',
      t.tbl || ': author or host updates', t.tbl, t.col);
    execute format('create policy %I on public.%I for delete to authenticated using (%I = auth.uid() or public.is_host())',
      t.tbl || ': author or host deletes', t.tbl, t.col);
  end loop;
end $$;

-- Action items can also be updated by whoever they are assigned to.
create policy "action_items: assignee updates" on public.action_items
  for update to authenticated
  using (assignee_id = auth.uid()) with check (public.is_member(auth.uid()));

create policy "sessions: members read" on public.sessions
  for select to authenticated using (public.is_member(auth.uid()));
create policy "session_attendance: members read" on public.session_attendance
  for select to authenticated using (public.is_member(auth.uid()));
create policy "agenda_items: members read" on public.agenda_items
  for select to authenticated using (public.is_member(auth.uid()));
create policy "agenda_items: members tick" on public.agenda_items
  for update to authenticated
  using (public.is_member(auth.uid())) with check (public.is_member(auth.uid()));

-- ============================================================
-- Grants
-- ============================================================

revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.members to authenticated;
grant select on public.sessions to authenticated;
grant select on public.session_attendance to authenticated;
grant select on public.agenda_items to authenticated;
grant update (done, done_by) on public.agenda_items to authenticated;

grant select, insert, update, delete on public.ideas, public.idea_stances, public.comments,
  public.rsvps, public.session_messages, public.posts, public.reactions,
  public.channel_messages, public.resources, public.action_items to authenticated;

-- Internal helpers are not callable from the API.
revoke execute on function public.gen_invite_code() from public, anon, authenticated;
revoke execute on function public.attendance_streak(uuid) from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Policy helpers: signed-in users need these for RLS evaluation.
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_host() from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_host() to authenticated;

-- RPCs: authenticated only. Revoking from PUBLIC matters because functions get
-- an implicit PUBLIC execute grant.
do $$
declare
  f text;
begin
  foreach f in array array[
    'table_status()', 'claim_host()', 'join_table(text)', 'rotate_invite_code()',
    'remove_member(uuid)', 'leave_table()', 'rename_table(text)', 'table_members()',
    'list_ideas(text)', 'idea_detail(uuid)',
    'list_sessions()', 'session_detail(uuid)',
    'create_session(text, timestamptz, text, text[])',
    'update_session(uuid, text, timestamptz, text, text[])',
    'set_session_status(uuid, text)', 'delete_session(uuid)',
    'save_session_notes(uuid, text)', 'mark_attendance(uuid)',
    'feed(integer)', 'channel_feed(text, timestamptz, integer)', 'list_resources()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public;
