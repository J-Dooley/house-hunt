// Pure rules shared with tests. Unknown never means Active.
export const BAD_STATUS = /pending|contingen|under.?contract|backup|bump|accepted|sold|closed|off.?market|withdrawn|cancel|expired|hold|coming.?soon|inactive/i;
export const KNOWN_STATUS = /^(active|for sale)$/i;
export function statusOf(raw, source) {
  const values = [raw.StandardStatus, raw.MlsStatus, raw.status, raw.Contingency, raw.ContingentDate, raw.PurchaseContractDate];
  if (values.some(v => typeof v === 'string' && BAD_STATUS.test(v))) return 'unavailable';
  if (raw.removedDate || raw.ContingentDate || raw.PurchaseContractDate) return 'unavailable';
  if (raw.Contingency && !['none','no','not applicable'].includes(String(raw.Contingency).toLowerCase())) return 'unavailable';
  if (source.adapter === 'rentcast') return raw.status === 'Inactive' ? 'unavailable' : 'unverified';
  const cfg = source.config || {};
  // Local MLS status codes must be reviewed when enabling a source. Never infer A/ACT.
  const local = raw[cfg.local_status_field || 'MlsStatus'];
  if (BAD_STATUS.test(String(local || ''))) return 'unavailable';
  if (!cfg.status_mapping_reviewed || !cfg.active_local_statuses?.includes(local)) return 'unverified';
  if (!KNOWN_STATUS.test(String(raw.StandardStatus || ''))) return 'unverified';
  // Feeds with a separate contingency field must explicitly document its clear values.
  for (const [field, clearValues] of Object.entries(cfg.clear_fields || {})) {
    if (!(field in raw) || !clearValues.includes(raw[field])) return 'unverified';
  }
  return 'active';
}
export function fresh(iso, now = new Date(), hours = 30) {
  const age = +new Date(now) - +new Date(iso || 'invalid');
  return Number.isFinite(age) && age >= -300000 && age <= hours * 3600000;
}
export function normalizeAddress(address) {
  const replacements = {street:'st',road:'rd',drive:'dr',lane:'ln',court:'ct',avenue:'ave',highway:'hwy',boulevard:'blvd',place:'pl',north:'n',south:'s',east:'e',west:'w'};
  return String(address || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).map(w=>replacements[w]||w).join(' ');
}
export function regionFor(n, rules) {
  return rules.regions.find(r=>r.state===n.state && r.county.toLowerCase()===String(n.county||'').replace(/ county$/i,'').toLowerCase());
}
export function criteria(n, rules) {
  const reasons=[]; const region=regionFor(n,rules);
  if(!region) reasons.push('outside_configured_region');
  if(region?.locality_review_required && n.locationConfirmed!==true) reasons.push('locality_unverified');
  const compound=n.track==='compound'; const track=compound?rules.compounds:rules.homes;
  if(!Number.isFinite(n.price)||n.price<=0) reasons.push('price_unknown');
  else if(n.price>track.max_price) reasons.push('over_price_cap');
  if(!Number.isFinite(n.acres)||n.acres<=0) reasons.push('acreage_unknown');
  else if(n.acres<(compound?track.min_acres:(region?.min_acres||rules.homes.min_acres))) reasons.push('below_acreage_minimum');
  if(n.siteBuilt!==true) reasons.push(n.siteBuilt===false?'excluded_construction':'site_built_unverified');
  if(n.existingDwelling!==true) reasons.push('existing_dwelling_unverified');
  if(compound && !(n.legalDetachedHomes>=track.min_legal_livable_detached_homes)) reasons.push('two_legal_livable_detached_homes_unverified');
  return {eligible:reasons.length===0,reasons,region:region?.key||null};
}
export function normalize(raw, source, rules, now=new Date()) {
  const rent=source.adapter==='rentcast'; const c=source.config||{};
  const field=(name,fallback)=>raw[c[name]||fallback];
  const price=Number(rent?raw.price:raw.ListPrice);
  const acres=rent?(raw.lotSize==null?NaN:Number(raw.lotSize)/43560):(raw.LotSizeAcres!=null?Number(raw.LotSizeAcres):raw.LotSizeSquareFeet!=null?Number(raw.LotSizeSquareFeet)/43560:NaN);
  const address=rent?[raw.addressLine1,raw.addressLine2].filter(Boolean).join(' '):raw.UnparsedAddress;
  const state=rent?raw.state:raw.StateOrProvince, city=rent?raw.city:raw.City, zip=rent?raw.zipCode:raw.PostalCode;
  const full=rent?raw.formattedAddress:[address,city,state,zip].filter(Boolean).join(', ');
  const subtype=String(rent?raw.propertyType:raw.PropertySubType||'');
  // Single-family classification alone does not establish site-built construction.
  const construction=field('construction_field','ConstructionType');
  const excluded=/manufactured|mobile|modular|land|condo|townhouse/i.test(subtype+' '+String(construction||''));
  const siteBuilt=excluded?false:(!rent && (c.site_built_values||[]).includes(construction)?true:null);
  const existingValue=field('existing_dwelling_field','PropertyCondition');
  const existingDwelling=!rent && (c.existing_dwelling_values||[]).includes(existingValue) && Number(raw.LivingArea)>0;
  const rawHomes=field('legal_detached_homes_field','HousehuntLegalDetachedHomes');
  const legalDetachedHomes=c.legal_detached_homes_field?Number(rawHomes)||0:0;
  const n={providerId:String(rent?raw.id:raw.ListingKey||''),address,fullAddress:full,canonicalKey:normalizeAddress(full),state,city,zip,county:rent?raw.county:raw.CountyOrParish,price,acres,siteBuilt,existingDwelling,legalDetachedHomes,
    track:price>rules.homes.max_price||legalDetachedHomes>=2?'compound':'home',
    locationConfirmed:c.location_confirmed_field?raw[c.location_confirmed_field]===true:false,
    status:statusOf(raw,source), checkedAt:new Date(now).toISOString(),
    sourceUpdatedAt:rent?raw.lastSeenDate:raw.ModificationTimestamp,
    listingUrl:rent?null:(raw.ListingURL||raw.VirtualTourURLUnbranded||null)};
  // A virtual tour is not proof of listing availability, nor a substitute listing URL.
  if(!raw.ListingURL)n.listingUrl=null;
  if(rent && !fresh(raw.lastSeenDate,now,rules.freshness_hours)) n.status='unverified';
  return {...n,...criteria(n,rules)};
}
export function isVisible(record,now=new Date(),hours=30) {
  return record.availability==='active' && record.eligible===true && fresh(record.verified_at,now,hours);
}
export function odataLiteral(s) {return "'"+String(s).replaceAll("'","''")+"'";}
export function safeProviderUrl(url, base) {
  const u=new URL(url), b=new URL(base);
  if(u.protocol!=='https:'||u.origin!==b.origin||u.username||u.password) throw Error('unsafe_provider_url');
  return u.toString();
}
export function discoveryUrl(source, region, cursor, rules) {
  const c=source.config||{};
  if(source.adapter==='rentcast') {
    const u=new URL('https://api.rentcast.io/v1/listings/sale');
    const params={state:region.state,status:'Active',price:`1:${rules.compounds.max_price}`,lotSize:'43560:',propertyType:'Single Family,Multi-Family',limit:'500',offset:String(cursor.offset||0),includeTotalCount:'true'};
    for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
    return u.toString();
  }
  if(cursor.nextUrl)return safeProviderUrl(cursor.nextUrl,c.base_url);
  const u=new URL(c.base_url.replace(/\/$/,'')+'/Property');
  // Do not filter only Active: changed listings must also remove prior active results.
  u.searchParams.set('$filter',`StateOrProvince eq ${odataLiteral(region.state)} and CountyOrParish eq ${odataLiteral(region.county)} and ListPrice le ${rules.compounds.max_price}`);
  u.searchParams.set('$top',String(c.page_size||100));
  u.searchParams.set('$orderby','ListingKey asc');
  return safeProviderUrl(u,c.base_url);
}
