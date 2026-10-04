-- Applied to the existing House Hunt project. No destructive table replacement.
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.househunt_inventory add column if not exists canonical_key text;
alter table public.househunt_inventory add column if not exists availability text not null default 'unverified';
alter table public.househunt_inventory add column if not exists verified_at timestamptz;
alter table public.househunt_inventory add column if not exists eligible boolean not null default false;
alter table public.househunt_inventory add column if not exists reasons jsonb not null default '["legacy_record_requires_verification"]';
alter table public.househunt_inventory add column if not exists normalized jsonb;
alter table public.househunt_inventory add column if not exists source_id text;
alter table public.househunt_inventory add column if not exists provider_id text;
alter table public.househunt_inventory add column if not exists review_hold boolean not null default false;
create index if not exists househunt_inventory_canonical on public.househunt_inventory(canonical_key);
create index if not exists househunt_inventory_provider on public.househunt_inventory(source_id,provider_id);

create table if not exists public.househunt_config (
 id boolean primary key default true check(id), settings jsonb not null
);
create table if not exists public.househunt_sources (
 id text primary key, name text not null, adapter text not null check(adapter in ('reso','rentcast')),
 enabled boolean not null default false, required boolean not null default false,
 authorization_confirmed boolean not null default false,
 public_display_authorized boolean not null default false,
 credential_env text not null, config jsonb not null default '{}',
 scope jsonb not null default '[]', monthly_request_limit integer not null default 0 check(monthly_request_limit>=0),
 notes text not null default ''
);
create table if not exists public.househunt_runs (
 id uuid primary key default gen_random_uuid(), run_key text unique not null,
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running', note text
);
create table if not exists public.househunt_jobs (
 id bigint generated always as identity primary key,
 run_id uuid not null references public.househunt_runs(id),
 source_id text not null references public.househunt_sources(id), region_key text not null,
 kind text not null default 'discovery', property_id text,
 status text not null default 'queued', cursor jsonb not null default '{}',
 pages integer not null default 0, records integer not null default 0,
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_until timestamptz, lease_token uuid, checked_at timestamptz, finished_at timestamptz,
 error text, unique(run_id,source_id,region_key,kind,property_id)
);
create index if not exists househunt_jobs_ready on public.househunt_jobs(status,available_at);
create index if not exists househunt_jobs_run on public.househunt_jobs(run_id);
create table if not exists public.househunt_observations (
 id bigint generated always as identity primary key,
 job_id bigint not null references public.househunt_jobs(id),
 source_id text not null, provider_id text not null,
 observed_at timestamptz not null default now(), normalized jsonb not null,
 unique(job_id,provider_id)
);
create table if not exists public.househunt_usage (
 source_id text not null references public.househunt_sources(id), month text not null,
 requests integer not null default 0, primary key(source_id,month)
);
create table if not exists public.househunt_worker_auth (
 id boolean primary key default true check(id), token_sha256 text not null
);

-- No client may write inventory, job state, observations, sources or secrets.
do $$ declare t text; begin
 foreach t in array array['househunt_config','househunt_sources','househunt_runs','househunt_jobs','househunt_observations','househunt_usage','househunt_worker_auth'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.househunt_jobs_id_seq,public.househunt_observations_id_seq to service_role;
grant all on public.househunt_inventory to service_role;
grant select on public.househunt_config,public.househunt_runs to anon,authenticated;
create policy househunt_read_config on public.househunt_config for select to anon,authenticated using(true);
create policy househunt_read_runs on public.househunt_runs for select to anon,authenticated using(true);
-- Coverage is an intentionally public receipt, separate from private worker cursors/errors.
create table if not exists public.househunt_coverage (
 job_id bigint primary key references public.househunt_jobs(id), run_id uuid not null,
 source_id text not null, source_name text not null, region_key text not null, kind text not null,
 status text not null, checked_at timestamptz, pages integer not null default 0, records integer not null default 0,
 note text
);
alter table public.househunt_coverage enable row level security;
revoke all on public.househunt_coverage from public,anon,authenticated;
grant select on public.househunt_coverage to anon,authenticated;
grant all on public.househunt_coverage to service_role;
create policy househunt_read_coverage on public.househunt_coverage for select to anon,authenticated using(true);

-- SECURITY INVOKER throughout: only service_role/postgres can call these functions.
create or replace function public.househunt_publish_receipt(p_job bigint) returns void
language sql security invoker set search_path='' as $$
 insert into public.househunt_coverage(job_id,run_id,source_id,source_name,region_key,kind,status,checked_at,pages,records,note)
 select j.id,j.run_id,j.source_id,s.name,j.region_key,j.kind,j.status,j.checked_at,j.pages,j.records,
 case j.status when 'blocked' then 'Source authorization or configuration required; not checked'
 when 'quota' then 'Request cap reached; incomplete'
 when 'failed' then 'Provider or processing failure; incomplete'
 when 'running' then 'Work in progress' else null end
 from public.househunt_jobs j join public.househunt_sources s on s.id=j.source_id where j.id=p_job
 on conflict(job_id) do update set status=excluded.status,checked_at=excluded.checked_at,pages=excluded.pages,records=excluded.records,note=excluded.note;
$$;

create or replace function public.househunt_finish_runs() returns void
language plpgsql security invoker set search_path='' as $$
begin
 update public.househunt_runs r set finished_at=now(),status=case
 when not exists(select 1 from public.househunt_jobs j where j.run_id=r.id) then 'blocked'
 when exists(select 1 from public.househunt_jobs j where j.run_id=r.id and j.status in('failed','quota','blocked')) then
   case when exists(select 1 from public.househunt_jobs j where j.run_id=r.id and j.status='complete') then 'partial' else 'blocked' end
 else 'complete' end
 where r.status='running' and not exists(select 1 from public.househunt_jobs j where j.run_id=r.id and j.status in('queued','running'));
end $$;

create or replace function public.househunt_start_run(p_manual boolean default false) returns uuid
language plpgsql security invoker set search_path='' as $$
declare rid uuid; s record; region jsonb; j bigint; cfg jsonb; k text; localnow timestamp;
begin
 localnow:=now() at time zone 'America/Chicago';
 if not p_manual and extract(hour from localnow)<>6 then return null; end if;
 select settings into cfg from public.househunt_config where id;
 if cfg is null then raise exception 'Househunt configuration missing'; end if;
 k:=case when p_manual then 'manual-'||gen_random_uuid()::text else 'daily-'||localnow::date::text end;
 insert into public.househunt_runs(run_key) values(k) on conflict(run_key) do nothing returning id into rid;
 if rid is null then return null; end if;
 -- Expiration hides stale results but never removes property IDs or preferences.
 update public.househunt_inventory set availability='unverified',reasons='["verification_expired"]'
 where availability='active' and (verified_at is null or verified_at < now()-make_interval(hours=>(cfg->>'freshness_hours')::int));
 for s in select * from public.househunt_sources where required or enabled loop
  for region in select value from jsonb_array_elements(cfg->'regions') loop
   if jsonb_array_length(s.scope)>0 and not s.scope ? (region->>'key') then continue; end if;
   -- RentCast has state searches; receipts use state:* and do not claim a county search.
   if s.adapter='rentcast' and exists(select 1 from public.househunt_jobs where run_id=rid and source_id=s.id and region_key=(region->>'state')||':*') then continue; end if;
   insert into public.househunt_jobs(run_id,source_id,region_key,status,error)
   values(rid,s.id,case when s.adapter='rentcast' then (region->>'state')||':*' else region->>'key' end,
    case when s.enabled and s.authorization_confirmed then 'queued' else 'blocked' end,
    case when s.enabled and s.authorization_confirmed then null else 'source_not_authorized' end) returning id into j;
   perform public.househunt_publish_receipt(j);
  end loop;
  -- Verify known provider IDs regardless of present price/acreage. Search omission is not a status.
  if s.enabled and s.authorization_confirmed then
   insert into public.househunt_jobs(run_id,source_id,region_key,kind,property_id)
   select rid,s.id,coalesce(i.normalized->>'state','unknown')||':existing','verify',i.property_id
   from public.househunt_inventory i where i.source_id=s.id and i.provider_id is not null;
  end if;
 end loop;
 for j in select id from public.househunt_jobs where run_id=rid loop perform public.househunt_publish_receipt(j); end loop;
 perform public.househunt_finish_runs();
 return rid;
end $$;

create or replace function public.househunt_claim_job() returns setof public.househunt_jobs
language plpgsql security invoker set search_path='' as $$
declare jid bigint;
begin
 -- A terminated worker is retried; leases prevent concurrent workers claiming one job.
 update public.househunt_jobs set status='failed',error='worker_lease_exhausted',finished_at=now()
 where status='running' and lease_until<now() and attempts>=5;
 for jid in select id from public.househunt_jobs where status='failed' and error='worker_lease_exhausted' loop perform public.househunt_publish_receipt(jid); end loop;
 select id into jid from public.househunt_jobs where
 ((status='queued' and available_at<=now()) or (status='running' and lease_until<now())) and attempts<5
 order by case when kind='verify' then 0 else 1 end,id for update skip locked limit 1;
 if jid is null then perform public.househunt_finish_runs(); return; end if;
 return query update public.househunt_jobs set status='running',lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid(),attempts=attempts+1
 where id=jid returning *;
end $$;

create or replace function public.househunt_reserve_request(p_source text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare lim int; used int; recent int; m text:=to_char(now() at time zone 'UTC','YYYY-MM');
begin
 select monthly_request_limit into lim from public.househunt_sources where id=p_source and enabled and authorization_confirmed for update;
 if lim is null or lim<=0 then return false; end if;
 -- Conservatively count both calendar months to avoid crossing a provider's billing-cycle reset.
 select coalesce(sum(requests),0) into recent from public.househunt_usage where source_id=p_source
 and month>=to_char((now() at time zone 'UTC')-interval '1 month','YYYY-MM');
 if recent>=lim then return false; end if;
 insert into public.househunt_usage(source_id,month) values(p_source,m) on conflict do nothing;
 update public.househunt_usage set requests=requests+1 where source_id=p_source and month=m and requests<lim returning requests into used;
 return used is not null;
end $$;

-- Create a high-entropy dispatcher credential in Vault without returning it to logs.
do $$ declare tok text; begin
 if not exists(select 1 from vault.secrets where name='househunt_worker_token') then
  tok:=encode(extensions.gen_random_bytes(32),'hex');
  perform vault.create_secret(tok,'househunt_worker_token','Internal Househunt worker dispatch only');
 else select decrypted_secret into tok from vault.decrypted_secrets where name='househunt_worker_token'; end if;
 insert into public.househunt_worker_auth(id,token_sha256) values(true,encode(extensions.digest(tok,'sha256'),'hex'))
 on conflict(id) do update set token_sha256=excluded.token_sha256;
end $$;

create or replace function public.househunt_dispatch_worker() returns bigint
language plpgsql security invoker set search_path='' as $$
declare req bigint;
begin
 if not exists(select 1 from public.househunt_jobs where (status='queued' and available_at<=now()) or (status='running' and lease_until<now())) then return null; end if;
 select net.http_post(
  url:='https://ajgmhmgxoiusguzkrnuz.supabase.co/functions/v1/househunt-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-househunt-token',(select decrypted_secret from vault.decrypted_secrets where name='househunt_worker_token')),
  body:='{}'::jsonb,timeout_milliseconds:=60000) into req;
 return req;
end $$;

revoke all on function public.househunt_publish_receipt(bigint), public.househunt_finish_runs(),public.househunt_start_run(boolean),public.househunt_claim_job(),public.househunt_reserve_request(text),public.househunt_dispatch_worker() from public,anon,authenticated;
grant execute on function public.househunt_publish_receipt(bigint), public.househunt_finish_runs(),public.househunt_start_run(boolean),public.househunt_claim_job(),public.househunt_reserve_request(text) to service_role;

-- Both possible UTC hours, guarded by America/Chicago hour, handles daylight saving.
select cron.schedule('househunt-daily','0 11,12 * * *','select public.househunt_start_run(false)');
select cron.schedule('househunt-worker','* * * * *','select public.househunt_dispatch_worker()');
