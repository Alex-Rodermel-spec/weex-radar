// Aggregate-only V110 forecast diagnostics from published encrypted journal.
// No market requests, trades, private rows or change to live signals.
const HORIZONS=[5,10,15,30];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const pct=(n,d)=>d?Math.round(n/d*1000)/10:null;
const avg=(n,d)=>d?Math.round(n/d*100)/100:null;
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
   horizons,timingGroups,byStrengthTiming};
 }
 return {...result,status:'OBSERVED_AGGREGATES_ONLY',
  disclaimer:'Descriptive historical direction outcomes, not an independent trading backtest or executable profit.'};
}
