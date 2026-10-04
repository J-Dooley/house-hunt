-- Run as postgres in a transaction. Fixtures never persist or reach public results.
begin;
do $$
declare rid uuid; jid bigint; lease uuid:=gen_random_uuid(); n jsonb; p text; original_count int;
begin
 select count(*) into original_count from public.property_preferences;
 insert into public.househunt_sources(id,name,adapter,enabled,authorization_confirmed,public_display_authorized,credential_env,monthly_request_limit)
 values('__test__','Test fixture','reso',true,true,true,'UNUSED_TEST_KEY',2);
 insert into public.househunt_runs(run_key) values('__test__') returning id into rid;
 insert into public.househunt_jobs(run_id,source_id,region_key,status,lease_token,lease_until)
 values(rid,'__test__','CA:Shasta','running',lease,now()+interval '3 minutes') returning id into jid;
 n:=jsonb_build_object('providerId','fixture','address','1 Test Rd','fullAddress','1 Test Rd, Test, CA 96001','canonicalKey','househunt integration fixture',
 'state','CA','city','Test','zip','96001','county','Shasta','price',400000,'acres',5,'status','active','eligible',true,'region','CA:Shasta','reasons','[]'::jsonb);
 perform public.househunt_complete_page(jid,lease,jsonb_build_array(n),'{}',true);
 select property_id into p from public.househunt_inventory where canonical_key='househunt integration fixture';
 if not exists(select 1 from public.househunt_inventory where property_id=p and availability='active' and eligible) then raise exception 'Active insertion failed'; end if;
 update public.househunt_inventory set details=details||'{"why":"Preserve research","fit_display":"88 fit"}' where property_id=p;
 -- A pending/contingent observation must remove active visibility without deleting research.
 update public.househunt_jobs set status='running',lease_token=lease,lease_until=now()+interval '3 minutes' where id=jid;
 perform public.househunt_complete_page(jid,lease,jsonb_build_array(n||'{"status":"unavailable"}'),'{}',true);
 if not exists(select 1 from public.househunt_inventory where property_id=p and availability='unavailable' and details->>'why'='Preserve research' and details->>'fit_display'='88 fit') then raise exception 'Status/research preservation failed'; end if;
 if (select count(*) from public.househunt_observations where job_id=jid)<>1 then raise exception 'Duplicate observation on replay'; end if;
 -- Invalid lease cannot mutate a completed page.
 begin
  perform public.househunt_complete_page(jid,gen_random_uuid(),jsonb_build_array(n),'{}',true);
  raise exception 'Invalid lease accepted';
 exception when others then if sqlerrm<>'Job lease expired' then raise; end if; end;
 if not public.househunt_reserve_request('__test__') or not public.househunt_reserve_request('__test__') or public.househunt_reserve_request('__test__') then raise exception 'Request cap failed'; end if;
 if (select count(*) from public.property_preferences)<>original_count then raise exception 'Preferences modified'; end if;
 if has_function_privilege('anon','public.househunt_start_run(boolean)','execute') then raise exception 'Anonymous scheduling allowed'; end if;
 if has_table_privilege('anon','public.househunt_worker_auth','select') then raise exception 'Worker secret exposed'; end if;
 if has_table_privilege('authenticated','public.househunt_inventory','update') then raise exception 'Client inventory writes allowed'; end if;
 if not exists(select 1 from public.househunt_coverage where job_id=jid and status='complete' and pages=2) then raise exception 'Receipt missing'; end if;
end $$;
rollback;
