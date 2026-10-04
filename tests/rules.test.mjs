import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {statusOf,criteria,normalize,fresh,isVisible,discoveryUrl,safeProviderUrl,normalizeAddress} from '../supabase/functions/househunt-worker/rules.mjs';
const rules=JSON.parse(readFileSync(new URL('../config/search.json',import.meta.url)));
const source={adapter:'reso',config:{status_mapping_reviewed:true,active_local_statuses:['Active'],construction_field:'ConstructionType',site_built_values:['Site Built'],existing_dwelling_field:'PropertyCondition',existing_dwelling_values:['Existing']}};
const now=new Date('2026-10-04T21:00:00Z');
const raw={ListingKey:'123',StandardStatus:'Active',MlsStatus:'Active',ConstructionType:'Site Built',PropertyCondition:'Existing',LivingArea:1200,UnparsedAddress:'12 Oak Rd',City:'Redding',StateOrProvince:'CA',PostalCode:'96001',CountyOrParish:'Shasta',ListPrice:499000,LotSizeAcres:5};
test('reject every under-contract status including Active contingencies',()=>{
 for(const status of ['Pending','Contingent','Active Under Contract','Active Contingent','Pending - Accepting Backups','Sold','Closed','Off Market','Withdrawn','Cancelled','Expired','Hold','Coming Soon','Inactive']) {
  assert.notEqual(statusOf({...raw,MlsStatus:status},source),'active',status);
 }
 for(const r of [{Contingency:'Inspection'},{ContingentDate:'2026-10-04'},{PurchaseContractDate:'2026-10-01'}]) assert.equal(statusOf({...raw,...r},source),'unavailable');
});
test('unknown status codes and undocumented mappings never become active',()=>{
 assert.equal(statusOf({...raw,MlsStatus:'ACT'},source),'unverified');
 assert.equal(statusOf(raw,{adapter:'reso',config:{}}),'unverified');
 assert.equal(statusOf({...raw,StandardStatus:'Active Under Contract'},source),'unavailable');
 assert.equal(statusOf(raw,source),'active');
});
test('RentCast binary Active can discover but cannot verify no contingency',()=>{
 assert.equal(statusOf({status:'Active'},{adapter:'rentcast'}),'unverified');
 assert.equal(statusOf({status:'Inactive'},{adapter:'rentcast'}),'unavailable');
});
test('explicit contingency clear fields are mandatory when configured',()=>{
 const src={...source,config:{...source.config,clear_fields:{ContingentYN:[false]}}};
 assert.equal(statusOf(raw,src),'unverified');
 assert.equal(statusOf({...raw,ContingentYN:false},src),'active');
 assert.notEqual(statusOf({...raw,ContingentYN:true},src),'active');
});
test('normalization applies price, region, dwelling and acreage requirements',()=>{
 const n=normalize(raw,source,rules,now);assert.equal(n.eligible,true);assert.equal(n.status,'active');
 for(const edit of [{ListPrice:500001},{LotSizeAcres:1.9},{ConstructionType:'Manufactured'},{PropertyCondition:'Proposed'},{CountyOrParish:'Kern'}])assert.equal(normalize({...raw,...edit},source,rules,now).eligible,false);
 assert.equal(normalize({...raw,ConstructionType:undefined,PropertySubType:'Single Family Residence'},source,rules,now).eligible,false);
 assert.equal(normalize({...raw,CountyOrParish:'Santa Cruz',LotSizeAcres:1},source,rules,now).eligible,true);
});
test('compounds require two legal livable detached homes, acreage and cap',()=>{
 const n={...normalize(raw,source,rules,now),track:'compound',price:2000000,acres:10,legalDetachedHomes:2};
 assert.equal(criteria(n,rules).eligible,true);
 for(const edit of [{price:2000001},{acres:9.99},{legalDetachedHomes:1}])assert.equal(criteria({...n,...edit},rules).eligible,false);
});
test('expired, future, missing or failed checks cannot appear as active',()=>{
 const row={availability:'active',eligible:true,verified_at:'2026-10-04T06:00:00Z'};
 assert.equal(isVisible(row,now),true);
 for(const v of [null,'invalid','2026-10-01T00:00:00Z','2027-01-01T00:00:00Z'])assert.equal(isVisible({...row,verified_at:v},now),false);
 assert.equal(isVisible({...row,eligible:false},now),false);
 assert.equal(isVisible({...row,availability:'unverified'},now),false);
 assert.equal(fresh('2026-10-03T15:00:00Z',now),true);
});
test('pagination may not forward feed credentials to another host',()=>{
 assert.throws(()=>safeProviderUrl('https://evil.example/data','https://feed.example/reso'));
 assert.throws(()=>safeProviderUrl('http://feed.example/reso','https://feed.example/reso'));
 assert.throws(()=>safeProviderUrl('https://user:pass@feed.example/data','https://feed.example/reso'));
 assert.equal(safeProviderUrl('https://feed.example/reso?page=2','https://feed.example/reso'),'https://feed.example/reso?page=2');
});
test('searches are paginated and do not discard status changes server-side',()=>{
 const u=new URL(discoveryUrl({...source,config:{...source.config,base_url:'https://feed.example/reso'}},{state:'CA',county:"O'County"},{},rules));
 assert.match(u.searchParams.get('$filter'),/O''County/);
 assert.doesNotMatch(u.searchParams.get('$filter'),/StandardStatus/);
 assert.equal(u.searchParams.get('$top'),'100');
});
test('address normalization preserves units and identifiers',()=>{
 assert.equal(normalizeAddress('12 Oak Road, Redding CA 96001'),normalizeAddress('12 Oak Rd Redding, CA 96001'));
 assert.notEqual(normalizeAddress('12 Oak Rd Apt 1'),normalizeAddress('12 Oak Rd Apt 2'));
});
test('original saved inventory retains every distinct preference identifier',()=>{
 const legacy=JSON.parse(readFileSync(new URL('../data/legacy-inventory.json',import.meta.url)));
 assert.equal(legacy.properties.length,80);assert.equal(new Set(legacy.properties.map(p=>p.id)).size,80);
 for(const p of legacy.properties){assert.ok(p.links);assert.ok(p.source_note);}
});
