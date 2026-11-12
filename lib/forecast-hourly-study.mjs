// Read-only time-of-day audit of ACTUALLY PUBLISHED independent forecast alerts.
// Only sentAt (the original ntfy publication time) determines the hour;
// subsequent closed WEEX candles measure direction and never determine the group.
// Berlin local calendar handles CET/CEST and the duplicated autumn 02:00 hour.
// Does not change LIVE alerts, score, filters, orders, or cron.
import {classifyForecastQualityShadow,QUALITY_GATE_PROTOCOL} from './forecast-quality-gate.mjs';

const ZONE='Europe/Berlin';
const formatter=new Intl.DateTimeFormat('en-GB',{
 timeZone:ZONE,hourCycle:'h23',hour:'2-digit',
 year:'numeric',month:'2-digit',day:'2-digit'
});
const HORIZONS=[5,15,20],VALID=new Set(['LONG','SHORT']);
const QUALITY_FROM=Date.parse(QUALITY_GATE_PROTOCOL.forwardFrom);
const round=n=>Math.round(n*10)/10;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const HOURLY_MIN_OBSERVED=30;
export const SESSION_MIN_OBSERVED=50;
export const MIN_DISTINCT_BERLIN_DAYS=5;
export const MIN_COVERAGE_PCT=80;

export function berlinHourDay(timestamp){
 if(!Number.isSafeInteger(timestamp)||timestamp<=0)return null;
 const parts=Object.fromEntries(formatter.formatToParts(new Date(timestamp))
  .filter(p=>['hour','year','month','day'].includes(p.type)).map(p=>[p.type,p.value]));
 const hour=Number(parts.hour)%24;
 if(!Number.isInteger(hour)||hour<0||hour>23)return null;
 return {hour,day:parts.year+'-'+parts.month+'-'+parts.day};
}
function outcomes(rows,h){
 const data=rows.map(r=>r.windows?.[h]);
 const measured=data.filter(w=>w?.status==='OBSERVED'&&finite(w.moveBps));
 const favorable=measured.filter(w=>w.moveBps>0).length,
  adverse=measured.filter(w=>w.moveBps<0).length,
  flat=measured.length-favorable-adverse;
 const pending=data.filter(w=>w?.status==='PENDING').length;
 const noData=data.length-measured.length-pending;
 const matured=data.length-pending;
 return {observed:measured.length,favorable,adverse,flat,pending,noData,
  favorablePct:measured.length?round(100*favorable/measured.length):null,
  coveragePct:matured?round(100*measured.length/matured):null};
}
function group(rows,tag,index,minObserved){
 const days=new Set(rows.map(r=>r.localDay));
 const stats=Object.fromEntries(HORIZONS.map(h=>['at'+h+'m',outcomes(rows,h)]));
 const five=stats.at5m,fifteen=stats.at15m;
 const eligible=five.observed>=minObserved&&fifteen.observed>=minObserved&&
  days.size>=MIN_DISTINCT_BERLIN_DAYS&&
  five.coveragePct>=MIN_COVERAGE_PCT&&
  fifteen.coveragePct>=MIN_COVERAGE_PCT;
 const directions=Object.fromEntries(['LONG','SHORT'].map(d=>{
  const subset=rows.filter(r=>r.direction===d);
  return [d,{total:subset.length,at5m:outcomes(subset,5),
   at15m:outcomes(subset,15)}];
 }));
 const forward=rows.filter(r=>r.sentAt>=QUALITY_FROM);
 const v3=Object.fromEntries(['PASS','SKIP','UNKNOWN'].map(k=>{
  const subset=forward.filter(r=>classifyForecastQualityShadow(r)===k);
  return [k,{total:subset.length,at5m:outcomes(subset,5)}];
 }));
 return {index,label:tag,total:rows.length,distinctBerlinDays:days.size,
  ...stats,byDirection:directions,v3ForwardOnly:v3,
  reviewEligible:eligible};
}
export function forecastHourlyStudy(rows,now=Date.now()){
 if(!Array.isArray(rows))throw Error('FORECAST_HOURLY_INVALID_ARCHIVE');
 const valid=rows.filter(r=>r&&VALID.has(r.direction)&&
  Number.isSafeInteger(r.sentAt)&&r.sentAt>0&&r.sentAt<=now)
  .map(r=>{const time=berlinHourDay(r.sentAt);
   return time?{...r,localHour:time.hour,localDay:time.day}:null;
  }).filter(Boolean);
 const hours=Array.from({length:24},(_,hour)=>group(
  valid.filter(r=>r.localHour===hour),
  String(hour).padStart(2,'0')+':00–'+String((hour+1)%24).padStart(2,'0')+':00',
  hour,HOURLY_MIN_OBSERVED
 ));
 const sessions=Array.from({length:6},(_,i)=>group(
  valid.filter(r=>Math.floor(r.localHour/4)===i),
  String(i*4).padStart(2,'0')+':00–'+String((i+1)*4).padStart(2,'0')+':00',
  i,SESSION_MIN_OBSERVED
 ));
 const eligibleHours=hours.filter(x=>x.reviewEligible);
 const eligibleSessions=sessions.filter(x=>x.reviewEligible);
 const ordered=(a,b)=>b.at5m.favorablePct-a.at5m.favorablePct;
 return {mode:'READ_ONLY_FORECAST_BERLIN_TIME_OF_DAY',
  timeZone:ZONE,groupedBy:'original ntfy sentAt',archived:valid.length,
  protocol:{minimumObservedHourly:HOURLY_MIN_OBSERVED,
   minimumObservedFourHourSession:SESSION_MIN_OBSERVED,
   minimumDistinctBerlinDays:MIN_DISTINCT_BERLIN_DAYS,
   minimumCoveragePct:MIN_COVERAGE_PCT,
   measuredHorizonsMinutes:HORIZONS,
   originalForecastsOnly:true,independentOutOfSampleValidation:false,
   rankingNeverChangesLiveAlerts:true},
  hours,sessions,
  reviewCandidates:{
   hourly:eligibleHours.slice().sort(ordered).map(x=>x.index),
   sessions:eligibleSessions.slice().sort(ordered).map(x=>x.index)
  },
  caveat:'Timezone Europe/Berlin including daylight saving. A high in-sample hit rate after selecting the best of 24 hours may be random; repeated correlated alerts, LONG/SHORT mix, 24-way multiple comparisons, exchange fees and execution slippage are not controlled. No hour can be called statistically optimal or used to suppress alerts without separate prospective validation. All percentages are observed price direction, not profits.'};
}
