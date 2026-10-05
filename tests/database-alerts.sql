-- Transactional tests for supabase/sql/alerts.sql. Fixtures roll back.
begin;
do $$
declare r jsonb; lead jsonb; before_obs int; cnt int;
begin
 insert into public.househunt_config(id,settings) values(true,'{"freshness_hours":30,"regions":[{"key":"CA:Shasta","state":"CA","county":"Shasta"},{"key":"OR:Douglas","state":"OR","county":"Douglas"}]}')
  on conflict(id) do update set settings=excluded.settings;
 -- A fresh active record owned by a licensed feed, and a saved legacy record with research.
 insert into public.househunt_sources(id,name,adapter,enabled,authorization_confirmed,public_display_authorized,credential_env,monthly_request_limit)
  values('feedx','Feed X','reso',false,false,false,'UNUSED',1);
 insert into public.househunt_inventory(property_id,details,canonical_key,availability,verified_at,eligible,source_id,provider_id)
  values('feed-1','{"why":"feed research"}','1 feed rd redding ca 96001','active',now(),true,'feedx','K1'),
        ('legacy-1','{"why":"Preserve research","fit_display":"91 fit"}','2 legacy rd redding ca 96001','unverified',null,false,null,null);
 -- Unauthorized source refuses.
 begin perform public.househunt_ingest_alert('portal-alerts','m0','redfin',now(),'[]'); raise exception 'Unauthorized source accepted';
 exception when others then if sqlerrm<>'Alert source not authorized' then raise; end if; end;
 update public.househunt_sources set enabled=true,authorization_confirmed=true,public_display_authorized=true where id='portal-alerts';
 lead:=jsonb_build_object('providerId','redfin:111','address','12 Oak Rd','fullAddress','12 Oak Rd, Redding, CA 96001','canonicalKey','12 oak rd redding ca 96001','state','CA','city','Redding','zip','96001','county','Shasta','price',449000,'acres',6.5,'status','unverified','eligible',false,'region','CA:Shasta','reasons','["site_built_unverified"]'::jsonb,'listingUrl','https://www.redfin.com/CA/Redding/12-Oak-Rd-96001/home/111');
 -- The invariant: an alert claiming active is rejected outright.
 begin perform public.househunt_ingest_alert('portal-alerts','m-bad','redfin',now(),jsonb_build_array(lead||'{"status":"active"}')); raise exception 'Active alert accepted';
 exception when others then if sqlerrm<>'Alert rows may only be unverified or unavailable' then raise; end if; end;
 r:=public.househunt_ingest_alert('portal-alerts','m1','redfin',now(),jsonb_build_array(
   lead,
   lead||'{"providerId":"redfin:999","canonicalKey":"5 far rd bakersfield ca 93301","region":null,"county":"Kern","address":"5 Far Rd","fullAddress":"5 Far Rd, Bakersfield, CA 93301"}',
   lead||'{"providerId":"redfin:555","canonicalKey":"1 feed rd redding ca 96001","status":"unverified"}',
   lead||'{"providerId":"redfin:777","canonicalKey":"2 legacy rd redding ca 96001","status":"unavailable"}'));
 if (r->>'submitted')::int<>2 or (r->>'stored')::int<>1 or (r->>'withdrawn')::int<>1 or (r->>'left_unchanged')::int<>1 then raise exception 'Unexpected result %',r; end if;
 if not exists(select 1 from public.househunt_inventory where canonical_key='12 oak rd redding ca 96001' and availability='unverified' and not eligible and source_id='portal-alerts' and details->>'source_note' like 'Lead from a saved-search alert%') then raise exception 'Lead not stored as unverified lead'; end if;
 if exists(select 1 from public.househunt_inventory where canonical_key like '%bakersfield%') then raise exception 'Out-of-region lead entered inventory'; end if;
 if not exists(select 1 from public.househunt_inventory where property_id='feed-1' and availability='active' and source_id='feedx') then raise exception 'Alert downgraded or replaced a feed record'; end if;
 if not exists(select 1 from public.househunt_inventory where property_id='legacy-1' and availability='unavailable' and details->>'why'='Preserve research' and details->>'fit_display'='91 fit' and reasons ? 'alert_reports_unavailable') then raise exception 'Withdrawal lost research or did not apply'; end if;
 -- A pending alert for a feed-active property withdraws it without deleting research.
 perform public.househunt_ingest_alert('portal-alerts','m2','zillow',now(),jsonb_build_array(lead||'{"providerId":"zillow:1","canonicalKey":"1 feed rd redding ca 96001","status":"unavailable"}'));
 if not exists(select 1 from public.househunt_inventory where property_id='feed-1' and availability='unavailable' and verified_at is null and details->>'why'='feed research') then raise exception 'Pending alert did not withdraw feed record'; end if;
 -- Replay of the same message is a no-op.
 select count(*) into before_obs from public.househunt_observations;
 if public.househunt_ingest_alert('portal-alerts','m1','redfin',now(),jsonb_build_array(lead))->>'duplicate' is distinct from 'true' then raise exception 'Replay not detected'; end if;
 if (select count(*) from public.househunt_observations)<>before_obs then raise exception 'Replay wrote observations'; end if;
 -- Quarantined emails are logged and ingest nothing.
 if (public.househunt_ingest_alert('portal-alerts','m3','redfin',now(),'[]','no_addresses_found')->>'quarantine')<>'no_addresses_found' then raise exception 'Quarantine not recorded'; end if;
 -- A later alert never promotes a stored lead to active.
 perform public.househunt_ingest_alert('portal-alerts','m4','redfin',now(),jsonb_build_array(lead||'{"price":439000}'));
 if exists(select 1 from public.househunt_inventory where source_id='portal-alerts' and availability='active') then raise exception 'Alert source produced an active record'; end if;
 if (select details->>'price' from public.househunt_inventory where canonical_key='12 oak rd redding ca 96001')<>'$439,000' then raise exception 'Price update missing'; end if;
 -- Daily scheduler must not queue county or verify jobs for the push source.
 perform public.househunt_start_run(true);
 select count(*) into cnt from public.househunt_jobs where source_id='portal-alerts' and region_key<>'ALERT:inbox';
 if cnt<>0 then raise exception 'Scheduler queued % jobs for alert source',cnt; end if;
 -- Receipt shows the inbox as one non-county row, not county coverage.
 if not exists(select 1 from public.househunt_coverage where source_id='portal-alerts' and region_key='ALERT:inbox' and status='complete') then raise exception 'Inbox receipt missing'; end if;
 if has_function_privilege('anon','public.househunt_ingest_alert(text,text,text,timestamptz,jsonb,text)','execute') then raise exception 'Anonymous ingest allowed'; end if;
 if has_table_privilege('anon','public.househunt_alert_messages','select') then raise exception 'Alert log exposed'; end if;
end $$;
rollback;
