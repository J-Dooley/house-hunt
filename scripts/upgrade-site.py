"""One-time upgrade of existing Househunt markup. Does not replace its design or research."""
from pathlib import Path
import re
p=Path(__file__).resolve().parents[1]/'index.html'
s=p.read_text()
if 'automation-client.mjs' in s:
    raise SystemExit('Already upgraded')
s=re.sub(r'<details class="quality-note".*?</details>', '', s, count=1, flags=re.S)
s=re.sub(r'<div class="notice">.*?</div>', '''<div class="notice"><strong>Verified active listings only.</strong> Pending, contingent, sold, off-market and unverified listings are excluded from these results. Earlier research, favorites and hidden choices are retained. <span id="automation-status" role="status" aria-live="polite">Loading current verification and coverage…</span></div><details class="notice"><summary>Sources and regions checked</summary><p>Each row records actual work. “Not checked” does not mean no matching homes. Source checks can lag a listing's real-time status.</p><div style="overflow:auto"><table style="width:100%;text-align:left;border-spacing:12px"><thead><tr><th>Region</th><th>Source</th><th>Task</th><th>Result</th><th>Pages</th><th>Records</th><th>Checked</th></tr></thead><tbody id="coverage-rows"><tr><td colspan="7">Loading coverage…</td></tr></tbody></table></div></details>''',s,count=1,flags=re.S)
s=s.replace('<button data-tab="Hidden">Hidden</button>','<button data-tab="Hidden">Hidden</button><button data-tab="Archive">Saved archive</button>')
s=re.sub(r'<label style="font-size:12px;.*?Include held records</label>','',s,count=1)
s=re.sub(r'<div class="foot">.*?</div>', '<div class="foot">The saved archive preserves previous research and preferences. Only fresh, explicitly active, qualifying records appear in normal results. Evidence expires after 30 hours. Confirm availability with the listing agent before making arrangements.</div>',s,count=1,flags=re.S)
s=re.sub(r'const isHeld=p=>.*?;const area=', "const isHeld=p=>{const a=p._automation;const age=Date.now()-Date.parse(a?.verified_at||'');return !(a?.availability==='active'&&a?.eligible===true&&Number.isFinite(age)&&age>=-300000&&age<=30*3600000)};const area=",s,count=1)
s=s.replace("if(tab==='Hidden')return state.hidden.includes(p.id);", "if(tab==='Archive')return isHeld(p);if(tab==='Hidden')return state.hidden.includes(p.id);")
s=s.replace("if(!['All','Favorites'].includes(tab)&&area(p)!==tab)return false;", "if(tab==='Compounds')return p._automation?.normalized?.track==='compound'||/compound|multi.generational/i.test(p.region);if(!['All','Favorites'].includes(tab)&&area(p)!==tab)return false;")
s=s.replace(".filter(p=>($('held').checked||tab==='Hidden'||!isHeld(p)))", ".filter(p=>(tab==='Archive'||!isHeld(p)))")
s=s.replace("['sort','search','held']", "['sort','search']")
s=s.replace("tab==='All'?'Property matches':tab+' properties'", "tab==='Archive'?'Saved archive · not active listings':tab==='All'?'Verified active matches':tab+' properties'")
s=s.replace("${esc(p.status_label)}", "${esc(p._automation?p.status_label:'NOT CURRENTLY VERIFIED · ARCHIVED')}")
s=s.replace("${score(p)}/100 preliminary fit", "${parseInt(p.fit_display)?score(p)+'/100 preliminary fit':'Not yet assessed'}")
s=s.replace("<b>Review status</b>","<b>Saved research notes</b>")
s=s.replace('</body>', '<script>window.househunt={properties,photos:verifiedCoverPhotos,render};</script><script type="module" src="./automation-client.mjs"></script></body>')
p.write_text(s)
print('Updated existing site; inventory and preference code retained')
