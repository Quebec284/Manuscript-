-- =====================================================================
-- Manuscript Management System – Supabase schema
-- Run this whole file once in Supabase → SQL Editor. Safe to re-run.
-- Security model: clients can READ only what row-level security allows and
-- can WRITE only through the SECURITY DEFINER functions below (no direct
-- insert/update/delete on tables), so roles and workflow cannot be bypassed.
-- =====================================================================

-- ---------- tables ----------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  email          text not null unique,
  role           text not null default 'User' check (role in ('Administrator','Editor','Author','User')),
  active         boolean not null default true,
  requested_role text check (requested_role in ('Author','Editor')),
  request_status text check (request_status in ('Pending','Approved','Rejected')),
  request_date   timestamptz,
  created_at     timestamptz not null default now()
);
-- Consent record (Terms of Service / Privacy Policy / Session cookies). NULL = not recorded yet.
alter table public.profiles add column if not exists terms_accepted   boolean;
alter table public.profiles add column if not exists privacy_accepted boolean;
alter table public.profiles add column if not exists cookies_accepted boolean;
alter table public.profiles add column if not exists consent_at       timestamptz;

create table if not exists public.manuscripts (
  id          bigint generated always as identity primary key,
  title       text not null,
  genre       text not null default 'Other',
  keywords    text not null default '',
  author_id   uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  status      text not null default 'Draft' check (status in ('Draft','Submitted','Under Review','Returned','Editor Approved','Approved')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.manuscript_versions (
  id             bigint generated always as identity primary key,
  manuscript_id  bigint not null references public.manuscripts(id) on delete cascade,
  version_number int not null,
  file_name      text not null,
  file_size      bigint not null default 0,
  file_path      text not null,
  uploaded_by    uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  unique (manuscript_id, version_number)
);

create table if not exists public.reviews (
  id            bigint generated always as identity primary key,
  manuscript_id bigint not null references public.manuscripts(id) on delete cascade,
  editor_id     uuid references public.profiles(id),
  editor_name   text not null,
  decision      text not null check (decision in ('Approved','Returned','Final Approved','Final Returned')),
  reviewer_role text not null default 'Editor',
  comments      text not null default '',
  created_at    timestamptz not null default now()
);

create table if not exists public.notifications (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  message       text not null,
  manuscript_id bigint,
  is_read       boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  user_name  text not null default 'Unknown',
  action     text not null,
  item       text,
  success    boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- upgrade older databases (two-step approval) ----------
-- Older versions had a single editor approval ('Approved'). Those manuscripts now wait for the
-- administrator's final approval. Runs once; re-running this file is safe.
alter table public.reviews add column if not exists reviewer_role text not null default 'Editor';
do $$
declare legacy boolean; n int;
begin
  select not exists (select 1 from pg_constraint where conrelid = 'public.manuscripts'::regclass
                     and conname = 'manuscripts_status_check' and pg_get_constraintdef(oid) like '%Editor Approved%') into legacy;
  alter table public.manuscripts drop constraint if exists manuscripts_status_check;
  if legacy then
    update public.manuscripts set status = 'Editor Approved' where status = 'Approved';
    get diagnostics n = row_count;
  end if;
  alter table public.manuscripts add constraint manuscripts_status_check
    check (status in ('Draft','Submitted','Under Review','Returned','Editor Approved','Approved'));
  alter table public.reviews drop constraint if exists reviews_decision_check;
  alter table public.reviews add constraint reviews_decision_check
    check (decision in ('Approved','Returned','Final Approved','Final Returned'));
  if legacy and n > 0 then
    insert into public.notifications(user_id, message)
      select id, n || ' manuscript(s) approved earlier now await your final approval' from public.profiles where role = 'Administrator' and active;
  end if;
end $$;

create index if not exists idx_ms_author   on public.manuscripts(author_id);
create index if not exists idx_ms_status   on public.manuscripts(status);
create index if not exists idx_ver_ms      on public.manuscript_versions(manuscript_id);
create index if not exists idx_rev_ms      on public.reviews(manuscript_id);
create index if not exists idx_nt_user     on public.notifications(user_id, created_at desc);
create index if not exists idx_audit_time  on public.audit_log(created_at desc);

-- ---------- helpers ----------
-- Role of the current user; NULL when signed out or when the account is disabled.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() and active $$;

create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as
$$ select full_name from public.profiles where id = auth.uid() $$;

create or replace function public.mid(p_id bigint) returns text
language sql immutable as $$ select 'MS-' || lpad(p_id::text, 3, '0') $$;

create or replace function public.notify(p_user uuid, p_msg text, p_ms bigint default null) returns void
language sql security definer set search_path = public as
$$ insert into public.notifications(user_id, message, manuscript_id) values (p_user, p_msg, p_ms) $$;

create or replace function public.notify_role(p_role text, p_msg text, p_ms bigint default null) returns void
language sql security definer set search_path = public as
$$ insert into public.notifications(user_id, message, manuscript_id)
   select id, p_msg, p_ms from public.profiles where role = p_role and active $$;

create or replace function public.log_event(p_action text, p_item text default null, p_ok boolean default true) returns void
language sql security definer set search_path = public as
$$ insert into public.audit_log(user_id, user_name, action, item, success)
   values (auth.uid(), coalesce(public.my_name(), 'Unknown'), left(p_action, 120), left(p_item, 200), p_ok) $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_ms_touch on public.manuscripts;
create trigger trg_ms_touch before update on public.manuscripts for each row execute function public.touch_updated_at();

create or replace function public.bump_manuscript() returns trigger
language plpgsql security definer set search_path = public as
$$ begin update public.manuscripts set updated_at = now() where id = new.manuscript_id; return new; end $$;
drop trigger if exists trg_ver_bump on public.manuscript_versions;
create trigger trg_ver_bump after insert on public.manuscript_versions for each row execute function public.bump_manuscript();

-- ---------- new account → profile (role "User"; Author/Editor become a pending request) ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  want text := new.raw_user_meta_data ->> 'requested_role';
  nm   text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 80);
  c    jsonb := case when jsonb_typeof(new.raw_user_meta_data -> 'consent') = 'object' then new.raw_user_meta_data -> 'consent' end;
  t boolean; p boolean; k boolean;
begin
  if c is not null then
    t := (c ->> 'terms') = 'accepted'; p := (c ->> 'privacy') = 'accepted'; k := (c ->> 'cookies') = 'accepted';
  end if;
  insert into public.profiles(id, full_name, email, requested_role, request_status, request_date,
                              terms_accepted, privacy_accepted, cookies_accepted, consent_at)
  values (new.id, nm, lower(new.email),
          case when want in ('Author','Editor') then want end,
          case when want in ('Author','Editor') then 'Pending' end,
          case when want in ('Author','Editor') then now() end,
          t, p, k, case when c is not null then now() end);
  insert into public.audit_log(user_id, user_name, action, item)
  values (new.id, nm, 'Registered account', lower(new.email) ||
          case when c is not null then ' (terms ' || case when t then 'accepted' else 'rejected' end ||
            ', privacy ' || case when p then 'accepted' else 'rejected' end ||
            ', cookies ' || case when k then 'accepted' else 'rejected' end || ')' else '' end);
  if want in ('Author','Editor') then
    perform public.notify_role('Administrator', nm || ' requested the ' || want || ' role');
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- keep profiles.email in step when a user confirms an email change in Supabase Auth
create or replace function public.sync_user_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(new.email) where id = new.id;
    insert into public.audit_log(user_id, user_name, action, item)
    values (new.id, coalesce((select full_name from public.profiles where id = new.id), 'Unknown'), 'Changed email', lower(new.email));
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users for each row execute function public.sync_user_email();

-- ---------- workflow functions (the ONLY way clients write data) ----------
create or replace function public.create_manuscript(p_title text, p_genre text, p_keywords text, p_file_name text, p_file_size bigint)
returns table(ms_id bigint, ms_path text)
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_path text;
begin
  if public.app_role() is distinct from 'Author' then raise exception 'Only authors can submit manuscripts'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'A title is required'; end if;
  insert into public.manuscripts(title, genre, keywords, author_id, author_name, status)
  values (trim(p_title), coalesce(nullif(p_genre, ''), 'Other'), coalesce(p_keywords, ''), auth.uid(), public.my_name(), 'Draft')
  returning id into v_id;
  v_path := auth.uid()::text || '/' || v_id || '/v1-' || regexp_replace(p_file_name, '[^A-Za-z0-9._-]', '_', 'g');
  insert into public.manuscript_versions(manuscript_id, version_number, file_name, file_size, file_path, uploaded_by)
  values (v_id, 1, p_file_name, coalesce(p_file_size, 0), v_path, auth.uid());
  perform public.log_event('Created manuscript', public.mid(v_id));
  return query select v_id, v_path;
end $$;

create or replace function public.add_version(p_ms bigint, p_file_name text, p_file_size bigint) returns text
language plpgsql security definer set search_path = public as $$
declare r public.manuscripts; n int; v_path text;
begin
  select * into r from public.manuscripts where id = p_ms for update;
  if not found or r.author_id <> auth.uid() or public.app_role() is distinct from 'Author' then raise exception 'Not permitted'; end if;
  if r.status <> 'Returned' then raise exception 'Only manuscripts returned for revision can receive a new version'; end if;
  select coalesce(max(version_number), 0) + 1 into n from public.manuscript_versions where manuscript_id = p_ms;
  v_path := auth.uid()::text || '/' || p_ms || '/v' || n || '-' || regexp_replace(p_file_name, '[^A-Za-z0-9._-]', '_', 'g');
  insert into public.manuscript_versions(manuscript_id, version_number, file_name, file_size, file_path, uploaded_by)
  values (p_ms, n, p_file_name, coalesce(p_file_size, 0), v_path, auth.uid());
  return v_path;
end $$;

-- Clean-up helpers used when a file upload fails after its database row was created.
create or replace function public.discard_manuscript(p_ms bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.manuscripts where id = p_ms and author_id = auth.uid() and status = 'Draft'
    and (select count(*) from public.manuscript_versions where manuscript_id = p_ms) = 1;
end $$;

create or replace function public.discard_version(p_ms bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.manuscript_versions v
  using public.manuscripts m
  where v.manuscript_id = p_ms and m.id = p_ms and m.author_id = auth.uid() and m.status = 'Returned'
    and v.version_number > 1
    and v.version_number = (select max(version_number) from public.manuscript_versions where manuscript_id = p_ms);
end $$;

create or replace function public.submit_manuscript(p_ms bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.manuscripts; v_last timestamptz;
begin
  select * into r from public.manuscripts where id = p_ms for update;
  if not found or r.author_id <> auth.uid() or public.app_role() is distinct from 'Author' then raise exception 'Not permitted'; end if;
  if r.status not in ('Draft','Returned') then raise exception 'This manuscript cannot be submitted in its current state'; end if;
  if r.status = 'Returned' then
    select max(created_at) into v_last from public.reviews where manuscript_id = p_ms and decision in ('Returned','Final Returned');
    if not exists (select 1 from public.manuscript_versions where manuscript_id = p_ms and created_at > v_last) then
      raise exception 'Upload a revised version before resubmitting';
    end if;
  end if;
  update public.manuscripts set status = 'Submitted' where id = p_ms;
  perform public.notify_role('Editor', case when r.status = 'Draft' then 'New manuscript submitted: ' else 'Revised version uploaded: ' end || '“' || r.title || '”', p_ms);
  perform public.log_event(case when r.status = 'Draft' then 'Submitted manuscript' else 'Uploaded revision' end, public.mid(p_ms));
end $$;

create or replace function public.start_review(p_ms bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.manuscripts;
begin
  if public.app_role() is distinct from 'Editor' then raise exception 'Only editors can review manuscripts'; end if;
  select * into r from public.manuscripts where id = p_ms for update;
  if not found or r.status <> 'Submitted' then raise exception 'Manuscript is not awaiting review'; end if;
  update public.manuscripts set status = 'Under Review' where id = p_ms;
  perform public.notify(r.author_id, '“' || r.title || '” is now under review', p_ms);
  perform public.log_event('Started review', public.mid(p_ms));
end $$;

create or replace function public.decide_manuscript(p_ms bigint, p_decision text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.manuscripts; v_new text;
begin
  if public.app_role() is distinct from 'Editor' then raise exception 'Only editors can approve or return manuscripts'; end if;
  if p_decision not in ('Approved','Returned') then raise exception 'Invalid decision'; end if;
  if p_decision = 'Returned' and coalesce(trim(p_comment), '') = '' then raise exception 'Add a comment explaining what to change'; end if;
  select * into r from public.manuscripts where id = p_ms for update;
  if not found or r.status not in ('Submitted','Under Review') then raise exception 'Manuscript is not awaiting a decision'; end if;
  v_new := case when p_decision = 'Approved' then 'Editor Approved' else 'Returned' end;
  insert into public.reviews(manuscript_id, editor_id, editor_name, decision, comments, reviewer_role)
  values (p_ms, auth.uid(), public.my_name(), p_decision, coalesce(nullif(trim(p_comment), ''), 'Approved by editor.'), 'Editor');
  update public.manuscripts set status = v_new where id = p_ms;
  if p_decision = 'Approved' then
    perform public.notify(r.author_id, '“' || r.title || '” was approved by the editor and now awaits final approval by an administrator', p_ms);
    perform public.notify_role('Administrator', 'Final approval needed: “' || r.title || '”', p_ms);
    perform public.log_event('Editor approved manuscript', public.mid(p_ms));
  else
    perform public.notify(r.author_id, '“' || r.title || '” was returned for revision', p_ms);
    perform public.log_event('Returned for revision', public.mid(p_ms));
  end if;
end $$;

-- Final approval: only an administrator, only after the editor has approved.
create or replace function public.final_decision(p_ms bigint, p_decision text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.manuscripts; v_editor uuid;
begin
  if public.app_role() is distinct from 'Administrator' then raise exception 'Only administrators can give final approval'; end if;
  if p_decision not in ('Approved','Returned') then raise exception 'Invalid decision'; end if;
  if p_decision = 'Returned' and coalesce(trim(p_comment), '') = '' then raise exception 'Add a comment explaining what to change'; end if;
  select * into r from public.manuscripts where id = p_ms for update;
  if not found or r.status <> 'Editor Approved' then raise exception 'Manuscript is not awaiting final approval'; end if;
  select editor_id into v_editor from public.reviews where manuscript_id = p_ms and decision = 'Approved' order by created_at desc, id desc limit 1;
  insert into public.reviews(manuscript_id, editor_id, editor_name, decision, comments, reviewer_role)
  values (p_ms, auth.uid(), public.my_name(),
          case when p_decision = 'Approved' then 'Final Approved' else 'Final Returned' end,
          coalesce(nullif(trim(p_comment), ''), 'Final approval granted.'), 'Administrator');
  update public.manuscripts set status = p_decision where id = p_ms;
  perform public.notify(r.author_id, '“' || r.title || '” ' || case when p_decision = 'Approved' then 'received final approval and is now published in the catalog' else 'was returned for revision by an administrator' end, p_ms);
  if v_editor is not null and v_editor <> auth.uid() then
    perform public.notify(v_editor, '“' || r.title || '” ' || case when p_decision = 'Approved' then 'received final approval' else 'was returned by an administrator' end, p_ms);
  end if;
  perform public.log_event(case when p_decision = 'Approved' then 'Final approval' else 'Returned by administrator' end, public.mid(p_ms));
end $$;

create or replace function public.request_role(p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and active;
  if not found or me.role = 'Administrator' then raise exception 'Not permitted'; end if;
  if p_role not in ('Author','Editor') or p_role = me.role then raise exception 'Invalid role request'; end if;
  update public.profiles set requested_role = p_role, request_status = 'Pending', request_date = now() where id = me.id;
  perform public.notify_role('Administrator', me.full_name || ' requested the ' || p_role || ' role');
  perform public.log_event('Requested role', p_role);
end $$;

create or replace function public.decide_role_request(p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u public.profiles;
begin
  if public.app_role() is distinct from 'Administrator' then raise exception 'Not permitted'; end if;
  select * into u from public.profiles where id = p_user and request_status = 'Pending';
  if not found then raise exception 'Request not found'; end if;
  update public.profiles set request_status = case when p_approve then 'Approved' else 'Rejected' end,
         role = case when p_approve then u.requested_role else role end where id = p_user;
  perform public.notify(p_user, case when p_approve then 'Your ' || u.requested_role || ' role was approved. Sign in as “' || u.requested_role || '”.'
                                     else 'Your ' || u.requested_role || ' role request was not approved.' end);
  perform public.log_event(case when p_approve then 'Approved role request' else 'Rejected role request' end, u.full_name || ' → ' || u.requested_role);
end $$;

create or replace function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare u public.profiles;
begin
  if public.app_role() is distinct from 'Administrator' then raise exception 'Not permitted'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_role not in ('Administrator','Editor','Author','User') then raise exception 'Invalid role'; end if;
  select * into u from public.profiles where id = p_user;
  if not found then raise exception 'User not found'; end if;
  update public.profiles set role = p_role,
         request_status = case when requested_role = p_role then 'Approved' else request_status end where id = p_user;
  perform public.notify(p_user, 'Your role is now ' || case when p_role = 'User' then 'Other user' else p_role end);
  perform public.log_event('Changed role', u.full_name || ' → ' || p_role);
end $$;

create or replace function public.set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u public.profiles;
begin
  if public.app_role() is distinct from 'Administrator' then raise exception 'Not permitted'; end if;
  if p_user = auth.uid() then raise exception 'You cannot disable your own account'; end if;
  select * into u from public.profiles where id = p_user;
  if not found then raise exception 'User not found'; end if;
  update public.profiles set active = p_active where id = p_user;
  perform public.log_event(case when p_active then 'Enabled user' else 'Disabled user' end, u.full_name);
end $$;

create or replace function public.update_my_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := left(trim(coalesce(p_name, '')), 80);
begin
  if v = '' then raise exception 'Name cannot be empty'; end if;
  update public.profiles set full_name = v where id = auth.uid() and active;
  if not found then raise exception 'Not permitted'; end if;
  update public.manuscripts set author_name = v where author_id = auth.uid();
  update public.reviews set editor_name = v where editor_id = auth.uid();
  perform public.log_event('Updated profile name', v);
end $$;

-- Update the caller's consent choices (Terms of Service / Privacy Policy / Session cookies).
create or replace function public.update_my_consent(p_terms boolean, p_privacy boolean, p_cookies boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set terms_accepted = p_terms, privacy_accepted = p_privacy, cookies_accepted = p_cookies, consent_at = now()
  where id = auth.uid() and active;
  if not found then raise exception 'Not permitted'; end if;
  perform public.log_event('Updated consent', 'terms ' || case when p_terms then 'accepted' else 'rejected' end || ', privacy ' ||
    case when p_privacy then 'accepted' else 'rejected' end || ', cookies ' || case when p_cookies then 'accepted' else 'rejected' end);
end $$;

-- Authors may delete their own drafts. Returns the file paths so the browser can remove the files.
create or replace function public.delete_draft(p_ms bigint) returns text[]
language plpgsql security definer set search_path = public as $$
declare r public.manuscripts; paths text[];
begin
  select * into r from public.manuscripts where id = p_ms for update;
  if not found or r.author_id <> auth.uid() or public.app_role() is distinct from 'Author' then raise exception 'Not permitted'; end if;
  if r.status <> 'Draft' then raise exception 'Only drafts can be deleted'; end if;
  select coalesce(array_agg(file_path), '{}') into paths from public.manuscript_versions where manuscript_id = p_ms;
  delete from public.manuscripts where id = p_ms;
  perform public.log_event('Deleted draft', public.mid(p_ms));
  return paths;
end $$;

create or replace function public.mark_read(p_id bigint default null) returns void
language sql security definer set search_path = public as
$$ update public.notifications set is_read = true where user_id = auth.uid() and (p_id is null or id = p_id) $$;

-- ---------- row-level security (read access) ----------
alter table public.profiles            enable row level security;
alter table public.manuscripts         enable row level security;
alter table public.manuscript_versions enable row level security;
alter table public.reviews             enable row level security;
alter table public.notifications       enable row level security;
alter table public.audit_log           enable row level security;

drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() = 'Administrator');

drop policy if exists p_ms_read on public.manuscripts;
create policy p_ms_read on public.manuscripts for select to authenticated using (
  public.app_role() = 'Administrator'
  or (public.app_role() = 'Editor' and status <> 'Draft')
  or (public.app_role() = 'Author' and author_id = auth.uid())
  or (public.app_role() = 'User' and status = 'Approved'));

drop policy if exists p_ver_read on public.manuscript_versions;
create policy p_ver_read on public.manuscript_versions for select to authenticated
  using (public.app_role() in ('Administrator','Editor','Author') and exists (select 1 from public.manuscripts m where m.id = manuscript_id));

drop policy if exists p_rev_read on public.reviews;
create policy p_rev_read on public.reviews for select to authenticated
  using (public.app_role() in ('Administrator','Editor','Author') and exists (select 1 from public.manuscripts m where m.id = manuscript_id));

drop policy if exists p_nt_read on public.notifications;
create policy p_nt_read on public.notifications for select to authenticated using (user_id = auth.uid());

drop policy if exists p_audit_read on public.audit_log;
create policy p_audit_read on public.audit_log for select to authenticated using (public.app_role() = 'Administrator');

-- No insert/update/delete policies exist: direct writes from the browser are denied.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

-- ---------- function permissions ----------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('app_role','my_name','mid','notify','notify_role','log_event','create_manuscript','add_version','discard_manuscript','discard_version',
       'submit_manuscript','start_review','decide_manuscript','final_decision','request_role','decide_role_request','set_user_role','set_user_active','update_my_name','update_my_consent','delete_draft','mark_read')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  -- internal helpers are not callable from the browser
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('notify','notify_role') loop
    execute format('revoke execute on function %s from authenticated', f.sig);
  end loop;
end $$;

-- ---------- file storage (private bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuscripts', 'manuscripts', false, 52428800,
        array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists mms_files_insert on storage.objects;
create policy mms_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'manuscripts' and public.app_role() = 'Author' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists mms_files_select on storage.objects;
create policy mms_files_select on storage.objects for select to authenticated using (
  bucket_id = 'manuscripts' and (
    public.app_role() in ('Administrator','Editor')
    or (public.app_role() = 'Author' and (storage.foldername(name))[1] = auth.uid()::text)));

drop policy if exists mms_files_delete on storage.objects;
create policy mms_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'manuscripts' and public.app_role() = 'Author' and (storage.foldername(name))[1] = auth.uid()::text);
