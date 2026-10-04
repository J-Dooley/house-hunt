import {isVisible} from './supabase/functions/househunt-worker/rules.mjs';
const API='https://ajgmhmgxoiusguzkrnuz.supabase.co/rest/v1/';
const KEY='sb_publishable_o3FrOR_rajcEg6RzwnlrNw_jX4Jbd73';
const ui=window.househunt;
const status=document.getElementById('automation-status');
const coverage=document.getElementById('coverage-rows');
let busy=false;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=s=>({blocked:'Not checked: authorization/configuration needed',complete:'Checked',partial:'Partially checked',queued:'Queued',running:'In progress',failed:'Failed',quota:'Stopped at request cap'}[s]||s);
const when=s=>s?new Date(s).toLocaleString('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short'})+' Central':'Never';
async function get(path){
 const r=await fetch(API+path,{headers:{apikey:KEY},cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Could not load current inventory');return r.json();
}
async function all(path){
 let result=[];
 for(let offset=0;;offset+=500){const page=await get(path+`&limit=500&offset=${offset}`);result.push(...page);if(page.length<500)return result;}
}
function receipts(rows){
 coverage.innerHTML=rows.map(r=>`<tr><td>${escape(r.region_key)}</td><td>${escape(r.source_name)}</td><td>${escape(r.kind)}</td><td>${escape(label(r.status))}</td><td>${r.pages}</td><td>${r.records}</td><td>${escape(when(r.checked_at))}</td></tr>`).join('')||'<tr><td colspan="7">No source checks recorded.</td></tr>';
}
async function refresh(){
 if(busy)return;busy=true;
 try{
  const [records,runs]=await Promise.all([all('househunt_inventory?select=*&order=property_id.asc'),get('househunt_runs?select=*&order=started_at.desc&limit=1')]);
  const byId=new Map(ui.properties.map(p=>[p.id,p]));
  for(const r of records){
   const existing=byId.get(r.property_id);
   const p={...existing,...r.details,_automation:r};
   p.status_label=isVisible(r)?'VERIFIED ACTIVE · '+when(r.verified_at):r.availability==='unavailable'?'UNAVAILABLE · ARCHIVED':!r.eligible?'REVIEW REQUIRED · ARCHIVED':'NOT CURRENTLY VERIFIED · ARCHIVED';
   if(existing)Object.assign(existing,p);else{ui.properties.push(p);byId.set(p.id,p);}
   if(r.cover_photo&&/^https:\/\//.test(r.cover_photo))ui.photos[r.property_id]=r.cover_photo;
  }
  const run=runs[0];
  const count=records.filter(r=>isVisible(r)).length;
  if(run){
   const checks=await all(`househunt_coverage?select=*&run_id=eq.${run.id}&order=region_key.asc,source_id.asc,job_id.asc`);
   receipts(checks);
   const completed=checks.filter(c=>c.status==='complete').length;
   status.textContent=`${count} verified active matches. Latest run: ${when(run.started_at)}. ${label(run.status)}. ${completed}/${checks.length} source/region tasks completed. Scheduled daily at 6:00 a.m. Central. `+(run.status==='blocked'?'Live discovery is waiting for an authorized listing feed.':'');
  } else status.textContent='No automated run recorded yet. Daily schedule: 6:00 a.m. Central.';
  ui.render();
 }catch{
  status.textContent='Current inventory could not be loaded. Saved research is retained; expired or unverified properties stay out of active results.';
  ui.render();
 }finally{busy=false;}
}
// Expiration also applies to a browser left open during a failed overnight run.
setInterval(()=>ui.render(),60000);
setInterval(refresh,300000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
await refresh();
