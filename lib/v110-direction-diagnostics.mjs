// Aggregate-only V110 forecast diagnostics from published encrypted journal.
// No market requests, trades, private rows or change to live signals.
const HORIZONS=[5,10,15,30];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pct=(n,d)=>d?Math.round(n/d*1000)/10:null;
const avg=(n,d)=>d?Math.round(n/d*100)/100:null;
// Actual first fully closed post-publication 1m bar reaching +/-10bps.
// This timestamp was measured when the forecast was archived, not inferred
// from sparse 5/10/15/30-minute checkpoints. Legacy nulls are ambiguous:
// they can mean no such movement OR an unrecorded onset.
const validOnset=x=>Number.isInteger(x)&&x>=1&&x<=30;
// Compare the first observed +/-10bps closing-price threshold after a notice.
// At least one archived crossing time is required; two absent timestamps
// remain UNKNOWN (legacy nulls may indicate missing 1m observations).
// A crossing recorded at minute m establishes continuous 1m data up to m
// in the journal's original evaluation; absent opposite onset cannot have
// occurred earlier without being recorded. Never reinterpret as trade fills.
function firstBarrierOrder10bps(rows){
 let favorableFirst=0,adverseFirst=0,tiedInvalid=0,unknown=0;
 let bothRecorded=0,onlyFavorableRecorded=0,onlyAdverseRecorded=0;
 for(const r of rows){
  const fav=validOnset(r.firstFavorable10bpsMinute)?r.firstFavorable10bpsMinute:null;
  const adv=validOnset(r.firstAdverse10bpsMinute)?r.firstAdverse10bpsMinute:null;
  if(fav!==null&&adv!==null){
   bothRecorded++;
   if(fav===adv){tiedInvalid++;continue;}
   if(fav<adv)favorableFirst++;else adverseFirst++;
  }else if(fav!==null){onlyFavorableRecorded++;favorableFirst++;}
  else if(adv!==null){onlyAdverseRecorded++;adverseFirst++;}
  else unknown++;
 }
 const resolved=favorableFirst+adverseFirst;
 return {maturedWithObserved30m:rows.length,
  resolvedFirstCrossings:resolved,firstFavorable:favorableFirst,
  firstAdverse:adverseFirst,ambiguousTie:tiedInvalid,
  neitherRecordedOrUnknown:unknown,
  bothRecorded,onlyFavorableRecorded,onlyAdverseRecorded,
  firstFavorablePctAmongResolved:resolved>=20?pct(favorableFirst,resolved):null,
  firstAdversePctAmongResolved:resolved>=20?pct(adverseFirst,resolved):null,
  caveat:'Descriptive order of observed 1m closing-price threshold crossings, not trade profitability or full forecast accuracy. Null onset may mean no crossing or missing historical data.'};
}
function firstMove10bps(rows,now){
 const matured=rows.filter(r=>r.sentAt+35*60000<now&&
  r.windows?.[30]?.status==='OBSERVED'&&finite(r.windows[30].moveBps)&&
  Math.abs(r.windows[30].moveBps)<10000);
 const summarize=field=>{
  const minutes=matured.map(r=>r[field]).filter(validOnset).sort((a,b)=>a-b);
  const n=minutes.length;
  return {recorded:n,missingOrNotReached:matured.length-n,
   medianMinute:n>=20?minutes[Math.floor((n-1)/2)]:null,
   bands:n>=20?{
    '1-5':minutes.filter(x=>x<=5).length,
    '6-10':minutes.filter(x=>x>=6&&x<=10).length,
    '11-15':minutes.filter(x=>x>=11&&x<=15).length,
    '16-30':minutes.filter(x=>x>=16).length
   }:null};
 };
 return {eligibleMature30m:matured.length,
  favorable:summarize('firstFavorable10bpsMinute'),
  adverse:summarize('firstAdverse10bpsMinute'),
  firstThresholdOrder:firstBarrierOrder10bps(matured),
  thresholdOrderByStrength:Object.fromEntries(
   ['STRONG','STANDARD','CAUTION'].map(strength=>[
    strength,firstBarrierOrder10bps(matured.filter(r=>r.strength===strength))])),
  thresholdBps:10,
  source:'ARCHIVED_OBSERVED_1M_CLOSES',
  note:'Median and bands require 20 recorded onset times. Missing onset is NOT counted as an incorrect forecast or as proven no movement.'};
}
export function evaluateV110DirectionDiagnostics(rows,now=Date.now()){
 const result={mode:'V110_DIRECTION_DIAGNOSTICS',source:'PUBLISHED_FORECAST_JOURNAL',
  horizonsMinutes:HORIZONS,lateThresholdBps:10,ordersSent:0,
  changesLiveSignals:false,byDirection:{}};
 if(!Array.isArray(rows)||rows.length>5000||!Number.isSafeInteger(now))
  return {...result,status:'INVALID_INPUT'};
 const unique=new Map();
 for(const r of rows){
  if(!r||!(/^[a-f0-9]{32}$/).test(r.id||'')||
   !['LONG','SHORT'].includes(r.direction)||
   !Number.isSafeInteger(r.sentAt)||r.sentAt>now||
   !/^[A-Z0-9]{2,24}$/.test(r.symbol||''))continue;
  if(!unique.has(r.id))unique.set(r.id,r);
 }
 for(const side of ['LONG','SHORT']){
  const subset=[...unique.values()].filter(r=>r.direction===side);
  const known=subset.filter(r=>finite(r.preMove5mBps));
  const late=known.filter(r=>r.preMove5mBps>=10);
  const horizons={};
  for(const h of HORIZONS){
   const observed=subset.filter(r=>r.sentAt+(h+5)*60000<now&&
    r.windows?.[h]?.status==='OBSERVED'&&finite(r.windows[h].moveBps)&&
    Math.abs(r.windows[h].moveBps)<10000);
   const good=observed.filter(r=>r.windows[h].moveBps>0);
   horizons[h]={observed:observed.length,favorablePct:pct(good.length,observed.length),
    meanMoveBps:avg(observed.reduce((s,r)=>s+r.windows[h].moveBps,0),observed.length)};
  }
  const timingGroups={};
  for(const [name,group] of [['PREMOVE_BELOW_10BPS',known.filter(r=>r.preMove5mBps<10)],
   ['PREMOVE_AT_LEAST_10BPS',late]]){
   const matured=group.filter(r=>r.sentAt+35*60000<now&&
    r.windows?.[15]?.status==='OBSERVED'&&
    finite(r.windows[15].moveBps)&&Math.abs(r.windows[15].moveBps)<10000);
   timingGroups[name]={total:group.length,observed15m:matured.length,
    favorable15mPct:pct(matured.filter(r=>r.windows[15].moveBps>0).length,matured.length),
    mean15mBps:avg(matured.reduce((sum,r)=>sum+r.windows[15].moveBps,0),matured.length)};
  }
  // Check whether apparent timing effects are driven by signal strength.
  // Descriptive only: no threshold tuning, no live policy decisions.
  const byStrengthTiming={};
  for(const strength of ['STRONG','STANDARD','CAUTION']){
   const group=known.filter(r=>r.strength===strength);
   const parts={};
   for(const [label,part] of [['EARLY',group.filter(r=>r.preMove5mBps<10)],
    ['LATE',group.filter(r=>r.preMove5mBps>=10)]]){
    const valid=part.filter(r=>r.sentAt+35*60000<now&&
     r.windows?.[15]?.status==='OBSERVED'&&finite(r.windows[15].moveBps)&&
     Math.abs(r.windows[15].moveBps)<10000);
    parts[label]={n:valid.length,favorable15mPct:pct(
     valid.filter(r=>r.windows[15].moveBps>0).length,valid.length),
     mean15mBps:avg(valid.reduce((sum,r)=>sum+r.windows[15].moveBps,0),valid.length)};
   }
   byStrengthTiming[strength]=parts;
  }
  result.byDirection[side]={total:subset.length,preMoveKnown:known.length,
   lateCount:late.length,latePctOfKnown:pct(late.length,known.length),
   horizons,timingGroups,byStrengthTiming,
   firstMove10bps:firstMove10bps(subset,now)};
 }
 return {...result,status:'OBSERVED_AGGREGATES_ONLY',
  disclaimer:'Descriptive historical direction outcomes, not an independent trading backtest or executable profit.'};
}
