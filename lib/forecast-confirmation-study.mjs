// Read-only, strictly historical link between ACTUALLY PUBLISHED ntfy forecasts
// and ACTUALLY SENT confirmed WEEX alerts. Never changes dispatch or entry gates.
// A missing prior forecast is NOT a failed prediction: the forecast topic caps
// delivery and may lack archival coverage.
export const LINK_PROTOCOL=Object.freeze({
 version:'2026-11-11-v1',lookbackMinutes:30,
 minimumResolvedPerGroup:50,minimumSharedSymbols:3
});
const MIN=60000,DAY=86400000;
const labels=['AGREED','CONFLICT','NO_PRIOR','OUT_OF_COVERAGE'];
const finiteTime=x=>Number.isSafeInteger(x)&&x>0;
const symbolOk=s=>typeof s==='string'&&/^[A-Z0-9]{2,24}$/.test(s);
const sideOk=s=>s==='LONG'||s==='SHORT';
const round=x=>Math.round(x*10)/10;

export function linkPriorForecasts(confirmations,forecasts,now=Date.now()){
 if(!Array.isArray(confirmations)||!Array.isArray(forecasts))
  throw Error('LINK_INVALID_INPUT');
 // Index by symbol. Find the most recent STRICTLY PRIOR forecast, so no
 // future knowledge can leak into the analysis and later contradictory
 // forecasts supersede earlier agreeing ones.
 const index=new Map();
 for(const f of forecasts){
  if(!f||!symbolOk(f.symbol)||!sideOk(f.direction)||
    !finiteTime(f.sentAt)||f.sentAt>now)continue;
  if(!index.has(f.symbol))index.set(f.symbol,[]);
  index.get(f.symbol).push(f);
 }
 for(const group of index.values())group.sort((a,b)=>a.sentAt-b.sentAt);
 const published=[...index.values()].flat().map(f=>f.sentAt);
 const firstPublished=published.length?Math.min(...published):null;
 const lastPublished=published.length?Math.max(...published):null;
 const result=[];
 for(const c of confirmations){
  if(!c||!symbolOk(c.symbol)||!sideOk(c.direction)||
    !finiteTime(c.sentAt)||c.sentAt>now)continue;
  const history=index.get(c.symbol)||[];
  let lo=0,hi=history.length;
  while(lo<hi){
   const mid=(lo+hi)>>1;
   if(history[mid].sentAt<c.sentAt)lo=mid+1;else hi=mid;
  }
  const f=history[lo-1];
  const lead=f?c.sentAt-f.sentAt:null;
  const prior=f&&lead>0&&lead<=LINK_PROTOCOL.lookbackMinutes*MIN?f:null;
  // Before the first archived forecast (or long after the last one), no
  // service coverage can be inferred; never use those confirmations as the
  // control group when comparing prediction quality.
  const covered=firstPublished!==null&&c.sentAt>firstPublished&&
    c.sentAt<=lastPublished+LINK_PROTOCOL.lookbackMinutes*MIN;
  const relationship=!covered?'OUT_OF_COVERAGE':!prior?'NO_PRIOR':
    prior.direction===c.direction?'AGREED':'CONFLICT';
  result.push({symbol:c.symbol,direction:c.direction,status:c.status,
   sentAt:c.sentAt,relationship,leadMinutes:prior?lead/MIN:null});
 }
 return result;
}
function group(rows){
 const result={total:rows.length,TP:0,SL:0,resolved:0,
  pendingOrUncertain:0,tpRatePct:null,meanLeadMinutes:null};
 let leadTotal=0,leadCount=0;
 for(const row of rows){
  if(row.status==='TP'||row.status==='SL'){
   result[row.status]++;result.resolved++;
  }else result.pendingOrUncertain++;
  if(Number.isFinite(row.leadMinutes)){
   leadTotal+=row.leadMinutes;leadCount++;
  }
 }
 result.tpRatePct=result.resolved?round(100*result.TP/result.resolved):null;
 result.meanLeadMinutes=leadCount?round(leadTotal/leadCount):null;
 return result;
}
function cohort(rows){
 const groups=Object.fromEntries(labels.map(label=>[
  label,group(rows.filter(r=>r.relationship===label))
 ]));
 const byDirection=Object.fromEntries(['LONG','SHORT'].map(direction=>[
  direction,Object.fromEntries(labels.map(label=>[
   label,group(rows.filter(r=>r.direction===direction&&r.relationship===label))
  ]))
 ]));
 const a=rows.filter(r=>r.relationship==='AGREED'&&['TP','SL'].includes(r.status));
 const b=rows.filter(r=>r.relationship==='NO_PRIOR'&&['TP','SL'].includes(r.status));
 const common=[...new Set(a.map(r=>r.symbol))].filter(symbol=>
  b.some(r=>r.symbol===symbol));
 const eligible=groups.AGREED.resolved>=LINK_PROTOCOL.minimumResolvedPerGroup&&
  groups.NO_PRIOR.resolved>=LINK_PROTOCOL.minimumResolvedPerGroup&&
  common.length>=LINK_PROTOCOL.minimumSharedSymbols;
 return {total:rows.length,groups,byDirection,
  comparison:{status:eligible?'REVIEW_ONLY':'COLLECTING',
   sharedSymbols:common.length,readyForReview:eligible,
   agreedMinusNoPriorTpRatePp:eligible?
    round(groups.AGREED.tpRatePct-groups.NO_PRIOR.tpRatePct):null}};
}
export function summarizeForecastConfirmationStudy(confirmations,forecasts,now=Date.now()){
 const linked=linkPriorForecasts(confirmations,forecasts,now);
 const windows=Object.fromEntries([30,90].map(days=>[
  days,cohort(linked.filter(r=>r.sentAt>now-days*DAY))
 ]));
 return {protocol:LINK_PROTOCOL,windows,
  source:'Archived actually sent independent ntfy forecasts and confirmed WEEX ntfy alerts',
  pairing:'Newest same-symbol forecast strictly BEFORE confirmed alert, at most 30 minutes earlier; latest opposite forecast counts as conflict.',
  caveat:'OUT_OF_COVERAGE marks confirmed alerts before the first or long after the last archived forecast; excluded from comparison. NO_PRIOR means no published forecast found in the prior 30m while the archive was active, not a failed prediction. TP/SL are illustrative candle touches, not executed trades. Partial coverage, unequal coins, fees and market regimes can bias comparisons. This study never gates orders or notifications.'};
}
