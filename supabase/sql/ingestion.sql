-- Atomic page checkpoint: observations, cumulative inventory and cursor advance commit together.
create or replace function public.househunt_complete_page(p_job bigint,p_lease uuid,p_rows jsonb,p_cursor jsonb,p_complete boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.househunt_jobs; n jsonb; pid text; old public.househunt_inventory; sid text; conflicts boolean; vstatus text; details jsonb; url text;
begin
 select * into j from public.househunt_jobs where id=p_job and status='running' and lease_token=p_lease for update;
 if j.id is null or j.lease_until<now() then raise exception 'Job lease expired'; end if;
 if not exists(select 1 from public.househunt_sources where id=j.source_id and enabled and authorization_confirmed and public_display_authorized) then raise exception 'Source not authorized'; end if;
 for n in select value from jsonb_array_elements(p_rows) loop
  if coalesce(n->>'providerId','')='' or coalesce(n->>'canonicalKey','')='' then raise exception 'Missing listing identity'; end if;
  insert into public.househunt_observations(job_id,source_id,provider_id,normalized)
  values(j.id,j.source_id,n->>'providerId',n)
  on conflict(job_id,provider_id) do update set normalized=excluded.normalized,observed_at=now();
  -- Serialize identities across feeds. Preserve the existing ID so favorites survive.
  perform pg_advisory_xact_lock(hashtextextended(n->>'canonicalKey',0));
  select * into old from public.househunt_inventory where
   (source_id=j.source_id and provider_id=n->>'providerId') or canonical_key=n->>'canonicalKey'
   order by case when source_id=j.source_id and provider_id=n->>'providerId' then 0 else 1 end limit 1;
  pid:=coalesce(old.property_id,'discovered-'||md5(n->>'canonicalKey'));
  -- Binary-status discovery must not replace a fresh verifier's result or provider identity.
  -- Explicit negative observations still withhold the property, regardless of source.
  if n->>'status'='unverified' and old.availability='active' and old.verified_at>now()-interval '30 hours'
     and (select adapter from public.househunt_sources where id=j.source_id)='rentcast' then continue; end if;
  -- Store out-of-scope discoveries only as private observations, not new inventory entries.
  if old.property_id is null and n->>'region' is null then continue; end if;
  vstatus:=n->>'status';
  select exists(select 1 from (
   select distinct on(source_id,provider_id) normalized from public.househunt_observations
   where normalized->>'canonicalKey'=n->>'canonicalKey' and observed_at>now()-interval '30 hours'
   order by source_id,provider_id,observed_at desc,id desc
  ) latest where normalized->>'status'='unavailable') into conflicts;
  if vstatus='active' and conflicts then vstatus:='unverified'; end if;
  url:=n->>'listingUrl';
  if url is not null and url !~ '^https://' then url:=null; end if;
  details:=jsonb_build_object('id',pid,'address',n->>'address','place',concat_ws(', ',n->>'city',concat_ws(' ',n->>'state',n->>'zip')),
    'region',(n->>'county')||' County · Utilities to confirm','price',case when n->>'price' is null then 'Unknown' else '$'||to_char((n->>'price')::numeric,'FM999,999,999') end,
    'acreage',coalesce(n->>'acres','Unknown'),'status_label',upper(vstatus),'fit_display','Not assessed',
    'source_note','Discovered by an authorized data feed; no individual research yet.',
    'why','Assessment not yet recorded.','due','Confirm water, utilities, dwelling permits, land usability, access, insurance and medical services.',
    'links',jsonb_build_array(jsonb_build_object('label','Google Maps','url','https://www.google.com/maps/search/?api=1&query='||replace(n->>'fullAddress',' ','+'))));
  if url is not null then details:=jsonb_set(details,'{links}',(details->'links')||jsonb_build_array(jsonb_build_object('label','Open exact listing','url',url))); end if;
  if old.property_id is not null then
   -- Never overwrite why/due/facts/source_note, scores, custom links or cover images.
   details:=old.details||jsonb_build_object('price',details->'price','acreage',details->'acreage');
  end if;
  insert into public.househunt_inventory(property_id,details,canonical_key,availability,verified_at,eligible,reasons,normalized,source_id,provider_id,last_edited)
  values(pid,details,n->>'canonicalKey',vstatus,case when vstatus='active' then now() else null end,
    coalesce((n->>'eligible')::boolean,false) and not coalesce(old.review_hold,false),coalesce(n->'reasons','[]'::jsonb)||case when conflicts then '["conflicting_status_evidence"]'::jsonb else '[]'::jsonb end||case when old.review_hold then '["existing_research_hold"]'::jsonb else '[]'::jsonb end,n,j.source_id,n->>'providerId',now())
  on conflict(property_id) do update set details=excluded.details,canonical_key=excluded.canonical_key,availability=excluded.availability,
   verified_at=excluded.verified_at,eligible=excluded.eligible,reasons=excluded.reasons,normalized=excluded.normalized,source_id=excluded.source_id,provider_id=excluded.provider_id,last_edited=excluded.last_edited;
 end loop;
 update public.househunt_jobs set status=case when p_complete then 'complete' else 'queued' end,cursor=p_cursor,
  pages=pages+1,records=records+jsonb_array_length(p_rows),checked_at=now(),lease_until=null,lease_token=null,
  attempts=0,finished_at=case when p_complete then now() else null end
 where id=j.id;
 perform public.househunt_publish_receipt(j.id);
 perform public.househunt_finish_runs();
end $$;
revoke all on function public.househunt_complete_page(bigint,uuid,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.househunt_complete_page(bigint,uuid,jsonb,jsonb,boolean) to service_role;
