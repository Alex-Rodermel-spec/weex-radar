// Research-only: session cohorts on existing encrypted published-forecast archive.
// No market requests, private rows emitted, live #108 gates, alerts or trades.
const MIN=60000,DAY=86400000,MIN_N=20,MIN_DAYS=3;
const HORIZONS=Object.freeze([1,5,10,15,30]);
const CENTERS=Object.freeze([
 {key:'TOKYO',zone:'Asia/Tokyo',start:9,end:18},
 {key:'LONDON',zone:'Europe/London',start:8,end:17},
 {key:'NEW_YORK',zone:'America/New_York',start:9,end:18}
]);
// Local clock windows are RESEARCH references, NOT actual opening hours for
// 24/7 crypto futures, nor proof of any trader's physical country.
const CLOCKS=CENTERS.map(c=>({
 ...c,fmt:new Intl.DateTimeFormat('en-GB',{timeZone:c.zone,
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
}));
const BERLIN=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',
 year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});
const COHORTS=['OFF_HOURS','TOKYO','LONDON','NEW_YORK',
 'TOKYO+LONDON','TOKYO+NEW_YORK','LONDON+NEW_YORK',
 'TOKYO+LONDON+NEW_YORK'];
const parts=x=>Object.fromEntries(x.map(p=>[p.type,p.value]));
const percent=(a,b)=>b?Math.round(1000*a/b)/10:null;
const mean=(a,b)=>b?Math.round(100*a/b)/100:null;
const validMove=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<10000;

export function globalSessionAt(timestamp){
 if(!Number.isSafeInteger(timestamp)||timestamp<Date.UTC(2020,0,1))return null;
 const date=new Date(timestamp);
 if(!Number.isFinite(date.getTime()))return null;
 const active=CLOCKS.filter(c=>{
  const p=parts(c.fmt.formatToParts(date));
  const m=Number(p.hour)*60+Number(p.minute);
  return Number.isFinite(m)&&m>=c.start*60&&m<c.end*60;
 }).map(c=>c.key);
 const p=parts(BERLIN.formatToParts(date));
 return {cohort:active.join('+')||'OFF_HOURS',activeCenters:active,
  berlinDay:p.year+'-'+p.month+'-'+p.day,
  dayType:['Sat','Sun'].includes(p.weekday)?'WEEKEND':'WEEKDAY'};
}
function validRow(r,now){
 return r&&/^[a-f0-9]{32}$/.test(r.id||'')&&
  /^[A-Z0-9]{2,24}$/.test(r.symbol||'')&&
  ['LONG','SHORT'].includes(r.direction)&&
  Number.isSafeInteger(r.sentAt)&&r.sentAt<=now&&r.sentAt>now-90*DAY&&
  r.windows&&typeof r.windows==='object'&&!Array.isArray(r.windows);
}
function summarize(group,now){
 const horizons={};
 for(const h of HORIZONS){
  let immature=0,observed=0,noData=0,pending=0,invalid=0;
  let favorable=0,adverse=0,flat=0,movementSum=0;
  let spacedObserved=0,spacedFavorable=0;
  const days=new Set(),spacedDays=new Set();
  for(const x of group){
   if(x.row.sentAt+(h+5)*MIN>now){immature++;continue;}
   const w=x.row.windows[h];
   if(w?.status==='NO_DATA'){noData++;continue;}
   if(w?.status==='PENDING'){pending++;continue;}
   if(w?.status!=='OBSERVED'||!validMove(w.moveBps)){invalid++;continue;}
   observed++;days.add(x.session.berlinDay);movementSum+=w.moveBps;
   if(w.moveBps>0)favorable++;else if(w.moveBps<0)adverse++;else flat++;
   if(!x.overlap){
    spacedObserved++;spacedDays.add(x.session.berlinDay);
    if(w.moveBps>0)spacedFavorable++;
   }
  }
  const mature=group.length-immature,show=observed>=MIN_N&&days.size>=MIN_DAYS;
  horizons[h]={matured:mature,immature,observed,
   noDataAfterMaturity:noData,pendingAfterMaturity:pending,
   invalidAfterMaturity:invalid,unscoredAfterMaturity:noData+pending+invalid,
   observedCoveragePct:percent(observed,mature),
   observedBerlinDays:days.size,favorable,adverse,flat,
   favorablePctDescriptive:show?percent(favorable,observed):null,
   meanSignedBpsDescriptive:show?mean(movementSum,observed):null,
   spaced30mObserved:spacedObserved,spaced30mBerlinDays:spacedDays.size,
   spaced30mFavorablePctDescriptive:
    spacedObserved>=MIN_N&&spacedDays.size>=MIN_DAYS?
     percent(spacedFavorable,spacedObserved):null};
 }
 return {alerts:group.length,
  distinctBerlinDays:new Set(group.map(x=>x.session.berlinDay)).size,
  distinctSymbols:new Set(group.map(x=>x.row.symbol)).size,
  repeatedSameSymbolWithin30m:group.filter(x=>x.overlap).length,
  horizons};
}
export function evaluateV110GlobalSessions(rows,now=Date.now()){
 const base={mode:'V110_GLOBAL_SESSIONS_SHADOW',status:'DESCRIPTIVE_ONLY',
  source:'EXISTING_ENCRYPTED_PUBLISHED_NTFY_FORECAST_JOURNAL',
  referenceLocalHours:[
   'TOKYO 09:00-18:00 Asia/Tokyo','LONDON 08:00-17:00 Europe/London',
   'NEW_YORK 09:00-18:00 America/New_York'],
  timeZone:'Europe/Berlin',dstBy:'IANA time zones',
  cohortBasedOn:'Publication timestamp BEFORE outcome; overlapping centers separate',
  horizonMinutes:HORIZONS,maturityGraceMinutes:5,
  minObservedForDescriptiveRate:MIN_N,minBerlinDays:MIN_DAYS,
  noTrading:true,ordersSent:0,paidApiCalls:0,marketRequests:0,
  changesLive108:false,modelRetrained:false,canPromoteToLive:false,
  caveat:'These are reference local time windows, not proof of who traded or market hours. Correlated symbols, repeated alerts and shifts in volatility may explain differences. Signed close-to-reference movement is NOT a trade fill, net profit, or validated forecasting edge.'};
 if(!Array.isArray(rows)||rows.length>5000||!Number.isSafeInteger(now)||
   now<Date.UTC(2020,0,1))return {...base,status:'INVALID_INPUT'};
 const byId=new Map();let invalidRows=0,duplicateIds=0;
 for(const row of rows){
  if(!validRow(row,now)){invalidRows++;continue;}
  if(byId.has(row.id)){duplicateIds++;continue;}
  byId.set(row.id,row);
 }
 const ordered=[...byId.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id));
 const tagged=[],lastSymbol=new Map();
 for(const row of ordered){
  const session=globalSessionAt(row.sentAt);
  if(!session){invalidRows++;continue;}
  const prev=lastSymbol.get(row.symbol);
  const overlap=prev!==undefined&&row.sentAt-prev<30*MIN;
  tagged.push({row,session,overlap});
  lastSymbol.set(row.symbol,row.sentAt);
 }
 const byCohort=Object.fromEntries(COHORTS.map(k=>[
  k,summarize(tagged.filter(x=>x.session.cohort===k),now)]));
 const byDirectionAndCohort=Object.fromEntries(['LONG','SHORT'].map(side=>[
  side,Object.fromEntries(COHORTS.map(k=>[
   k,summarize(tagged.filter(x=>x.row.direction===side&&x.session.cohort===k),now)]))
 ]));
 return {...base,totalInputRows:rows.length,invalidRows,duplicateIds,
  uniquePublishedForecasts:tagged.length,allPublished:summarize(tagged,now),
  byCohort,byDirectionAndCohort,
  byDayType:Object.fromEntries(['WEEKDAY','WEEKEND'].map(k=>[
   k,summarize(tagged.filter(x=>x.session.dayType===k),now)])),
  exclusiveCohorts:true,noDoubleCountingAcrossCohorts:true,
  missingTreatment:'Mature missing/pending/invalid outcomes are not losses',
  warning:'Shadow-only. Compare across comparable instruments and subsequent untouched days with fee/slippage stress before any owner-approved live rule change.'};
}
