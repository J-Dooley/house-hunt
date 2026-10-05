-- Saved-search alert emails as a push source. Alerts can discover (unverified) or withdraw (unavailable); they can never set a
-- listing active, because an email cannot show the absence of a contingency today.
-- Apply once, after automation.sql, ingestion.sql and security.sql. Idempotent.
alter table public.househunt_sources drop constraint if exists househunt_sources_adapter_check;
alter table public.househunt_sources add constraint househunt_sources_adapter_check check (adapter in ('reso','rentcast','alerts'));

create table if not exists public.househunt_alert_messages (
 message_id text primary key, source_id text not null references public.househunt_sources(id),
 received_at timestamptz not null, site text, listings integer not null default 0, quarantine text,
 created_at timestamptz not null default now()
);
alter table public.househunt_alert_messages enable row level security;
revoke all on public.househunt_alert_messages from public,anon,authenticated;
grant all on public.househunt_alert_messages to service_role;

insert into public.househunt_sources(id,name,adapter,enabled,required,authorization_confirmed,public_display_authorized,credential_env,config,notes)
values('portal-alerts','Saved-search alert emails','alerts',false,false,false,false,'HOUSEHUNT_INBOUND_SECRET','{}',
 'Push source. Enable only after the owner confirms the saved searches are their own accounts and public display is acceptable.')
on conflict(id) do nothing;

-- Alerts are pushed, not polled: the daily run must not queue county jobs or verify jobs for them.
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
 for s in select * from public.househunt_sources where (required or enabled) and adapter<>'alerts' loop
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

create or replace function public.househunt_ingest_alert(p_source text,p_message_id text,p_site text,p_received timestamptz,p_rows jsonb,p_quarantine text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.househunt_sources; rid uuid; jid bigint; lease uuid:=gen_random_uuid(); n jsonb; old public.househunt_inventory;
 pass jsonb:='[]'::jsonb; withdrawn int:=0; kept int:=0; stored int:=0; keys text[]:='{}'; rk text;
begin
 select * into s from public.househunt_sources where id=p_source and adapter='alerts' and enabled and authorization_confirmed and public_display_authorized;
 if s.id is null then raise exception 'Alert source not authorized'; end if;
 if jsonb_typeof(p_rows)<>'array' then raise exception 'Rows must be an array'; end if;
 -- Defense in depth for the central rule: no alert row may claim active.
 if exists(select 1 from jsonb_array_elements(p_rows) r where r.value->>'status' is distinct from 'unverified' and r.value->>'status' is distinct from 'unavailable') then
  raise exception 'Alert rows may only be unverified or unavailable'; end if;
 insert into public.househunt_alert_messages(message_id,source_id,received_at,site,listings,quarantine)
 values(p_message_id,p_source,p_received,p_site,jsonb_array_length(p_rows),p_quarantine) on conflict do nothing;
 if not found then return jsonb_build_object('duplicate',true); end if;
 if jsonb_array_length(p_rows)=0 then return jsonb_build_object('submitted',0,'stored',0,'quarantine',p_quarantine); end if;
 rk:='alerts-'||(now() at time zone 'America/Chicago')::date::text;
 insert into public.househunt_runs(run_key,note) values(rk,'Saved-search alert emails') on conflict(run_key) do nothing;
 update public.househunt_runs set status='running',finished_at=null where run_key=rk returning id into rid;
 select id into jid from public.househunt_jobs where run_id=rid and source_id=p_source and region_key='ALERT:inbox' and kind='discovery';
 if jid is null then insert into public.househunt_jobs(run_id,source_id,region_key,status) values(rid,p_source,'ALERT:inbox','running') returning id into jid; end if;
 update public.househunt_jobs set status='running',lease_until=now()+interval '3 minutes',lease_token=lease,error=null where id=jid;
 for n in select value from jsonb_array_elements(p_rows) loop
  select * into old from public.househunt_inventory where canonical_key=n->>'canonicalKey' order by (source_id=p_source) desc nulls last limit 1;
  if old.property_id is not null and old.source_id is distinct from p_source then
   -- Another feed or the saved legacy record owns this property: an alert may only withdraw it, never confirm or replace it.
   if n->>'status'='unavailable' then
    insert into public.househunt_observations(job_id,source_id,provider_id,normalized) values(jid,p_source,n->>'providerId',n)
     on conflict(job_id,provider_id) do update set normalized=excluded.normalized,observed_at=now();
    update public.househunt_inventory set availability='unavailable',verified_at=null,
     reasons=(select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements_text(reasons||'["alert_reports_unavailable"]'::jsonb) x),last_edited=now()
     where property_id=old.property_id;
    withdrawn:=withdrawn+1;
   else kept:=kept+1; end if;
  else pass:=pass||jsonb_build_array(n); keys:=keys||(n->>'canonicalKey'); end if;
 end loop;
 perform public.househunt_complete_page(jid,lease,pass,'{}'::jsonb,true);
 update public.househunt_inventory set details=jsonb_set(details,'{source_note}',to_jsonb('Lead from a saved-search alert email. Availability, construction type and dwelling count are unverified; open the listing and confirm before relying on it.'::text))
  where source_id=p_source and canonical_key=any(keys) and details->>'source_note'='Discovered by an authorized data feed; no individual research yet.';
 select count(*) into stored from public.househunt_inventory where source_id=p_source and canonical_key=any(keys);
 return jsonb_build_object('submitted',jsonb_array_length(pass),'stored',stored,'withdrawn',withdrawn,'left_unchanged',kept);
end $$;
revoke all on function public.househunt_ingest_alert(text,text,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.househunt_ingest_alert(text,text,text,timestamptz,jsonb,text) to service_role;
