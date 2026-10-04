import {normalize,discoveryUrl,safeProviderUrl} from './rules.mjs';

const project=Deno.env.get('SUPABASE_URL');
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function db(path,method='GET',body=undefined) {
 const r=await fetch(`${project}/rest/v1/${path}`,{method,headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(`database_${r.status}`);
 return r.status===204?null:await r.json();
}
const rpc=(name,args={})=>db('rpc/'+name,'POST',args);
async function digest(text) {
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function stop(job,status,error) {
 await db(`househunt_jobs?id=eq.${job.id}&lease_token=eq.${job.lease_token}`,'PATCH',{status,error,finished_at:new Date().toISOString(),lease_until:null,lease_token:null});
 await rpc('househunt_publish_receipt',{p_job:job.id});
 await rpc('househunt_finish_runs');
}
async function process(job,rules) {
 const [source]=await db(`househunt_sources?id=eq.${encodeURIComponent(job.source_id)}`);
 if(!source?.enabled||!source.authorization_confirmed||!source.public_display_authorized) {
  await stop(job,'blocked','source_authorization_or_display_rights_missing');return;
 }
 const c=source.config||{};
 if(source.adapter==='reso'&&(!c.base_url||!c.status_mapping_reviewed||!c.active_local_statuses?.length)) {
  await stop(job,'blocked','reviewed_status_mapping_required');return;
 }
 const key=Deno.env.get(source.credential_env);
 if(!key){await stop(job,'blocked','credential_not_configured');return;}
 const region=rules.regions.find(r=>r.key===job.region_key)||{state:job.region_key.split(':')[0]};
 let url;
 if(job.kind==='verify') {
  const [property]=await db(`househunt_inventory?property_id=eq.${encodeURIComponent(job.property_id)}`);
  if(!property?.provider_id){await stop(job,'blocked','provider_identity_missing');return;}
  if(source.adapter==='rentcast') url='https://api.rentcast.io/v1/listings/sale/'+encodeURIComponent(property.provider_id);
  else {
   url=new URL(c.base_url.replace(/\/$/,'')+'/Property');
   url.searchParams.set('$filter',"ListingKey eq '"+property.provider_id.replaceAll("'","''")+"'");
   url=safeProviderUrl(url.toString(),c.base_url);
  }
 } else url=discoveryUrl(source,region,job.cursor,rules);
 if(!(await rpc('househunt_reserve_request',{p_source:source.id}))) {await stop(job,'quota','hard_request_cap_reached');return;}
 // Never follow redirects with authorization attached. Never log keys or response bodies.
 const response=await fetch(url,{headers:source.adapter==='rentcast'?{'X-Api-Key':key,Accept:'application/json'}:{Authorization:`Bearer ${key}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok){
  if(job.kind==='verify'&&response.status===404){
   await db(`househunt_inventory?property_id=eq.${encodeURIComponent(job.property_id)}`,'PATCH',{availability:'unverified',verified_at:null,reasons:['provider_record_not_found']});
   await stop(job,'failed','provider_record_not_found');return;
  }
  if(response.status===401||response.status===403){await stop(job,'blocked','provider_authorization_failed');return;}
  throw Error(`provider_http_${response.status}`);
 }
 const data=await response.json();
 const rows=source.adapter==='rentcast'?(Array.isArray(data)?data:[data]):data.value;
 if(!Array.isArray(rows))throw Error('provider_schema_invalid');
 const normalized=rows.map(row=>normalize(row,source,rules));
 if(normalized.some(n=>!n.providerId||!n.address||!n.state))throw Error('provider_identity_invalid');
 if(job.kind==='verify'&&!rows.length){
  await db(`househunt_inventory?property_id=eq.${encodeURIComponent(job.property_id)}`,'PATCH',{availability:'unverified',verified_at:null,reasons:['provider_record_not_found']});
 }
 let next={},complete=job.kind==='verify';
 if(!complete&&source.adapter==='rentcast') {
  const offset=(job.cursor.offset||0)+rows.length;
  const count=response.headers.get('X-Total-Count');
  const total=count===null?null:Number(count);
  complete=rows.length<500||(total!==null&&offset>=total);
  next={offset};
 } else if(!complete) {
  const link=data['@odata.nextLink'];
  complete=!link;
  if(link){
   const nextUrl=safeProviderUrl(new URL(link,url).toString(),c.base_url);
   if(nextUrl===url||(job.cursor.seen||[]).includes(nextUrl))throw Error('provider_pagination_loop');
   next={nextUrl,seen:[...(job.cursor.seen||[]),url]};
  }
 }
 await rpc('househunt_complete_page',{p_job:job.id,p_lease:job.lease_token,p_rows:normalized,p_cursor:next,p_complete:complete});
}
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const token=req.headers.get('x-househunt-token');
 if(!token||token.length!==64)return new Response('Unauthorized',{status:401});
 try {
  const [auth]=await db('househunt_worker_auth?select=token_sha256&limit=1');
  if(!auth||await digest(token)!==auth.token_sha256)return new Response('Unauthorized',{status:401});
  const [cfg]=await db('househunt_config?limit=1');
  const start=Date.now();let pages=0;
  // Bounded invocations; remaining pages survive in Postgres for the next minute.
  while(Date.now()-start<35000&&pages<4) {
   const [job]=await rpc('househunt_claim_job');if(!job)break;
   try{await process(job,cfg.settings);}
   catch(error){
    const raw=String(error?.message||'worker_failure');
    const code=/^(provider_http_\d+|provider_schema_invalid|provider_identity_invalid|provider_pagination_loop|unsafe_provider_url|database_\d+)$/.test(raw)?raw:'worker_timeout_or_failure';
    if(job.attempts>=5)await stop(job,'failed',code);
    else {
     await db(`househunt_jobs?id=eq.${job.id}&lease_token=eq.${job.lease_token}`,'PATCH',{status:'queued',error:code,available_at:new Date(Date.now()+Math.min(900,30*2**job.attempts)*1000).toISOString(),lease_until:null,lease_token:null});
     await rpc('househunt_publish_receipt',{p_job:job.id});
    }
   }
   pages++;
  }
  await rpc('househunt_finish_runs');
  return Response.json({processed_pages:pages});
 } catch {return Response.json({error:'worker_infrastructure_failure'},{status:500});}
});
