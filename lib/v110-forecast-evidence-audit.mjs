// #110: honest evidence census for ACTUALLY PUBLISHED forecast alerts.
// Pure aggregates from the existing decrypted-in-memory private journal.
// No market requests, persistence, ntfy, orders, ML training or live #108 gates.
const MIN=60_000;
const HORIZONS=Object.freeze([5,10,15,30]);
const MIN_DESCRIPTIVE_N=20;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<10_000;
const pct=(a,b)=>b?Math.round(1000*a/b)/10:null;
const mean=(a,b)=>b?Math.round(100*a/b)/100:null;
const day=t=>new Date(t).toISOString().slice(0,10);
const validRow=(r,now)=>r&&typeof r.id==='string'&&/^[a-f0-9]{32}$/.test(r.id)&&
  /^[A-Z0-9]{2,24}$/.test(r.symbol||'')&&['LONG','SHORT'].includes(r.direction)&&
  Number.isSafeInteger(r.sentAt)&&r.sentAt>0&&r.sentAt<=now&&
  r.sentAt>=now-90*86_400_000&&r.windows&&typeof r.windows==='object';

// A matured alert with unavailable candles is UNKNOWN, never a failed signal.
// An immature alert is not part of the outcome denominator, even if archive
// data incorrectly claims to have its future close already.
function horizonCensus(rows,h,now){
  let immature=0,observed=0,noData=0,pending=0,invalid=0;
  let favorable=0,adverse=0,flat=0,sum=0;
  for(const r of rows){
    if(r.sentAt+(h+5)*MIN>now){immature++;continue;}
    const w=r.windows?.[h];
    if(w?.status==='NO_DATA'){noData++;continue;}
    if(w?.status==='PENDING'){pending++;continue;}
    if(w?.status!=='OBSERVED'||!finite(w.moveBps)){invalid++;continue;}
    observed++;sum+=w.moveBps;
    if(w.moveBps>0)favorable++;
    else if(w.moveBps<0)adverse++;
    else flat++;
  }
  const matured=rows.length-immature;
  return {total:rows.length,matured,immature,observed,
    noDataAfterMaturity:noData,pendingAfterMaturity:pending,
    invalidAfterMaturity:invalid,
    unscoredAfterMaturity:noData+pending+invalid,
    observedCoveragePct:pct(observed,matured),
    favorable,adverse,flat,
    favorablePctOfObserved:observed>=MIN_DESCRIPTIVE_N?pct(favorable,observed):null,
    meanSignedBps:observed>=MIN_DESCRIPTIVE_N?mean(sum,observed):null};
}
function section(rows,now){
  return {alerts:rows.length,
    distinctUTCdays:new Set(rows.map(r=>day(r.sentAt))).size,
    distinctSymbols:new Set(rows.map(r=>r.symbol)).size,
    horizons:Object.fromEntries(HORIZONS.map(h=>[h,horizonCensus(rows,h,now)]))};
}
// Explicit finite publication-time 5m momentum, NOT future price action.
const priorGroup=r=>!finite(r.preMove5mBps)?'UNKNOWN':
  r.preMove5mBps>=10?'ALREADY_MOVED_AT_LEAST_10BPS':'MOVED_LESS_THAN_10BPS';

export function evaluateV110ForecastEvidence(rows,now=Date.now()){
  const base={mode:'V110_PUBLISHED_FORECAST_EVIDENCE_AUDIT',
    status:'AGGREGATES_ONLY',source:'EXISTING_ENCRYPTED_PUBLISHED_NTFY_FORECAST_JOURNAL',
    horizonMinutes:HORIZONS,maturityGraceMinutes:5,
    minimumForDescriptiveOutcomeRate:MIN_DESCRIPTIVE_N,
    perSymbolOverlapMinutes:30,
    noTrade:true,ordersSent:0,paidApiCalls:0,marketRequests:0,
    live108Changes:false,modelValidated:false,
    warning:'Signed closed-candle movement from the printed alert reference is NOT a fill, a tradable win rate, profit after costs, or evidence of independent predictive advantage. Related markets and repeated alerts remain correlated.'};
  if(!Array.isArray(rows)||rows.length>5000||!Number.isSafeInteger(now)||now<=0)
    return {...base,status:'INVALID_INPUT'};
  const byId=new Map();let invalidRows=0,duplicateIds=0;
  for(const row of rows){
    if(!validRow(row,now)){invalidRows++;continue;}
    if(byId.has(row.id)){duplicateIds++;continue;}
    byId.set(row.id,row);
  }
  const unique=[...byId.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id));
  const lastSymbol=new Map(),tagged=[];
  for(const row of unique){
    const prev=lastSymbol.get(row.symbol);
    const overlapping=prev!==undefined&&row.sentAt-prev<30*MIN;
    tagged.push({row,overlapping});
    lastSymbol.set(row.symbol,row.sentAt);
  }
  const matching=fn=>tagged.filter(fn).map(x=>x.row);
  return {...base,archivedInputRows:rows.length,uniquePublishedAlerts:unique.length,
    invalidRows,duplicateIds,
    allPublished:section(unique,now),
    byDirection:Object.fromEntries(['LONG','SHORT'].map(d=>[
      d,section(unique.filter(r=>r.direction===d),now)])),
    bySymbolSpacing:{
      NON_OVERLAPPING_30M:section(matching(x=>!x.overlapping),now),
      OVERLAPPING_WITHIN_30M:section(matching(x=>x.overlapping),now)
    },
    byPreAlert5mMove:Object.fromEntries([
      'MOVED_LESS_THAN_10BPS','ALREADY_MOVED_AT_LEAST_10BPS','UNKNOWN'
    ].map(k=>[k,section(unique.filter(r=>priorGroup(r)===k),now)])),
    observationDefinition:'Only forecasts actually published to the forecast ntfy channel. 5/10/15/30m signed movements are measured against the published 1m reference using fully subsequent closed bars. At least 5 extra minutes of maturity grace is required. Missing, pending and invalid outcomes are not counted as wrong.',
    pairingLimitation:'Unsent early 1m candidate receipts are NOT included. Their future candle pairing and durable storage remain a separate incomplete study.',
    samplingLimitation:'Same-symbol alerts <30m are marked overlapping. NON_OVERLAPPING_30M is only a spacing diagnostic; cross-symbol and cross-day observations may still be correlated.'};
}
