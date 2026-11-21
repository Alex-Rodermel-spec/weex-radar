// V110 V5 prospective proof: compare a V5 direction frozen in the actual
// ntfy publication with the subsequent 5m/15m CLOSED WEEX observations.
// Only the subset of ORIGINAL published ntfy forecasts is visible here.
// V5-only candidates which were NOT sent are unobserved. Never promote live.
const MIN=60_000,DAY=86_400_000;
const pct=(good,n)=>n?Math.round(1000*good/n)/10:null;
const round=x=>Math.round(x*100)/100;
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<100000;
const d=t=>new Date(t).toISOString().slice(0,10);
const sideSet=new Set(['LONG','SHORT','MIXED']);
export const V5_FORWARD_POLICY=Object.freeze({
 version:'v110-v5-publication-receipt-v1',
 source:'ORIGINAL_NTFY_V5_RECEIPT_IN_ENCRYPTED_JOURNAL',
 publicationTimeOnly:true,maxRows:5000,perSymbolSpacingMinutes:30,
 primaryMinutes:5,secondaryMinutes:15,minCompared:60,
 minDays:4,minimumSidesForPromotion:2,
 externalForwardCohortRequired:true,
 liveForecastUnchanged:true,live108Unchanged:true,
 tradingOrders:0,autoPromotion:false,extraMarketRequests:0
});
function score(rows,h,side){
 const seen=rows.filter(r=>r.windows?.[h]?.status==='OBSERVED'&&
  finite(r.windows[h].moveBps));
 const sign=r=>(side==='V5'&&r.v5Direction!==r.direction?-1:1);
 const moves=seen.map(r=>r.windows[h].moveBps*sign(r));
 const favorable=moves.filter(x=>x>0).length,
  adverse=moves.filter(x=>x<0).length;
 return {observed:seen.length,favorable,adverse,
  flat:seen.length-favorable-adverse,
  favorablePct:pct(favorable,seen.length),
  meanSignedBps:seen.length?round(moves.reduce((a,b)=>a+b,0)/seen.length):null};
}
export function evaluateV110V5Forward(rows,now=Date.now()){
 const p=V5_FORWARD_POLICY;
 const base={mode:'V110_FORECAST_V5_ACTUAL_PUBLISHED_FORWARD_AUDIT',
  protocol:p.version,status:'COLLECTING_PUBLISHED_V5_RECEIPTS',
  source:p.source,noTrade:true,ordersSent:0,liveForecastChanged:false,
  prospectiveOutcomeMeasured:false,recommendation:'KEEP_V4',
  warning:'Only legacy ntfy-selected notices are observed, not unsent V5-only signals; raw 5m/15m candle directions are NOT fills, profit after costs, independent across coins, or proof of a win-rate increase.'};
 if(!Array.isArray(rows)||rows.length>p.maxRows||!Number.isSafeInteger(now)||now<=0)
  return {...base,status:'INVALID_INPUT'};
 const valid=rows.filter(r=>r&&typeof r.id==='string'&&
  /^[a-f0-9]{32}$/.test(r.id)&&
  ['LONG','SHORT'].includes(r.direction)&&
  sideSet.has(r.v5Direction)&&
  Number.isSafeInteger(r.sentAt)&&r.sentAt>now-90*DAY&&r.sentAt<=now-35*MIN);
 const unique=new Map();
 for(const r of valid)if(!unique.has(r.id))unique.set(r.id,r);
 const sorted=[...unique.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id));
 const spaced=[],last=new Map();
 for(const r of sorted){
  const prev=last.get(r.symbol);
  if(prev!==undefined&&r.sentAt-prev<30*MIN)continue;
  last.set(r.symbol,r.sentAt);
  spaced.push(r);
 }
 const directions=spaced.filter(r=>r.v5Direction!=='MIXED');
 const note={receiptCount:sorted.length,spacedCount:spaced.length,
  mixedAbstentions:spaced.length-directions.length,
  candidateCount:directions.length,
  uniqueDays:new Set(directions.map(r=>d(r.sentAt))).size};
 const evaluated=directions.filter(r=>r.windows?.[5]?.status==='OBSERVED'&&
  finite(r.windows?.[5]?.moveBps));
 const cohorts=Object.fromEntries(['LONG','SHORT'].map(side=>{
  const subset=directions.filter(r=>r.v5Direction===side);
  return [side,{n:subset.length,oldAt5m:score(subset,5,'LEGACY'),
   v5At5m:score(subset,5,'V5')}];
 }));
 const baseline=score(directions,5,'LEGACY'),
  v5=score(directions,5,'V5');
 const secondary={baseline:score(directions,15,'LEGACY'),v5:score(directions,15,'V5')};
 const enough=evaluated.length>=p.minCompared&&note.uniqueDays>=p.minDays;
 const deltaPct=baseline.favorablePct===null||v5.favorablePct===null?null:
  round(v5.favorablePct-baseline.favorablePct);
 return {...base,...note,status:enough?'DESCRIPTIVE_READY_NOT_PROMOTABLE':
  'COLLECTING_PUBLISHED_V5_RECEIPTS',
  prospectiveOutcomeMeasured:evaluated.length>0,
  primary5m:{legacy:baseline,v5,differencePp:deltaPct},
  secondary15m:secondary,byV5Side:cohorts,
  allV5OnlyCandidatesObserved:false,
  independentForwardCohortValidated:false,
  recommendation:'KEEP_V4'};
}
