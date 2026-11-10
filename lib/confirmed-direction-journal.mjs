// READ-ONLY: evaluate direction/timing of ACTUALLY SENT confirmed WEEX
// LONG/SHORT ntfy notifications (NOT the independent forecast channel).
// Works with results from existing /api/signals?mode=quality, which already
// parses the owner-configured private ntfy topic. No trading/private WEEX APIs.
import {createHash} from 'node:crypto';
import {_test as radar} from '../api/signals.mjs';
import {
 normalizeForecastMinutes,evaluatePublishedForecast,mergeForecastArchive,
 summarizeForecastArchive
} from './forecast-journal.mjs';

export const MAX_CONFIRMED_AUDIT_ROWS=1200;
const DAY=86400000,MIN=60000;
const VALID_LEVEL=new Set(['STRONG','NORMAL']);
const VALID_DIRECTION=new Set(['LONG','SHORT']);
const VALID_STATUS=new Set(['TP','SL','PENDING','TIMEOUT','AMBIGUOUS','INTRABAR','NO_DATA']);
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const SYM=x=>typeof x==='string'&&radar.SYMBOLS.includes(x);
function validConfirmed(row,now){
 return row&&SYM(row.symbol)&&VALID_DIRECTION.has(row.direction)&&
 VALID_LEVEL.has(row.level)&&VALID_STATUS.has(row.status)&&
 Number.isSafeInteger(row.sentAt)&&row.sentAt>=now-110*MIN&&row.sentAt<=now+5000&&
 [row.entry,row.stop,row.take].every(positive)&&
 (row.direction==='LONG'?row.stop<row.entry&&row.entry<row.take:
  row.take<row.entry&&row.entry<row.stop);
}
export function toAuditReference(row,now=Date.now()){
 if(!validConfirmed(row,now))return null;
 // Stable id differentiates real notifications by coin/side/when/price, even
 // if a subscription lacks a server-side sequence_id.
 const id=createHash('sha256').update('weex:confirmed-direction-audit:v1|'+
  [row.symbol,row.direction,row.sentAt,row.entry].join('|')).digest('hex').slice(0,32);
 return {id,symbol:row.symbol,direction:row.direction,
  strength:row.level==='STRONG'?'STRONG':'STANDARD',
  reference:row.entry,sentAt:row.sentAt};
}
export async function recentConfirmedDirectionResearch(qualityRows,now=Date.now(),{
 fetchImpl=fetch
}={}){
 if(!Array.isArray(qualityRows)||qualityRows.length>200)
  throw Error('INVALID_CONFIRMED_RESEARCH_SOURCE');
 const references=qualityRows.map(row=>toAuditReference(row,now)).filter(Boolean);
 const seen=new Map(references.map(row=>[row.id,row]));
 const rows=[...seen.values()].sort((a,b)=>b.sentAt-a.sentAt).slice(0,70);
 const symbols=[...new Set(rows.map(row=>row.symbol))];
 let next=0,failed=0;
 const candles=new Map();
 async function worker(){
  while(next<symbols.length){
   const symbol=symbols[next++];
   try{
    const url='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
     encodeURIComponent(symbol)+'&interval=1m&limit=125';
    const res=await fetchImpl(url,{
     cache:'no-store',signal:AbortSignal.timeout(7000),
     headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-CONFIRMED-AUDIT/1.0'}
    });
    if(!res.ok)throw Error('WEEX_UNAVAILABLE');
    const body=await res.text();
    if(body.length>240000)throw Error('WEEX_TOO_LARGE');
    const raw=JSON.parse(body);
    const data=Array.isArray(raw)?raw:raw?.data;
    if(!Array.isArray(data))throw Error('BAD_WEEX_CANDLES');
    candles.set(symbol,normalizeForecastMinutes(data,now));
   }catch{failed++;}
  }
 }
 await Promise.all(Array.from({length:Math.min(4,symbols.length)},()=>worker()));
 const studied=rows.filter(r=>candles.has(r.symbol)).map(r=>
  evaluatePublishedForecast(r,candles.get(r.symbol),now));
 return {rows:studied,seen:rows.length,marketsFailed:failed};
}
export function mergeConfirmedDirectionArchive(oldRows,currentRows,now=Date.now()){
 const result=mergeForecastArchive(oldRows,currentRows,now);
 if(result.rows.length>MAX_CONFIRMED_AUDIT_ROWS)
  throw Error('CONFIRMED_AUDIT_ROWS_TOO_MANY');
 return result;
}
function slim(report){
 const pick=x=>({observed:x.observed,favorable:x.favorable,adverse:x.adverse,
  flat:x.flat,pending:x.pending,noData:x.noData,
  favorablePct:x.favorablePct,meanDirectionBps:x.meanDirectionBps});
 return {total:report.total,at5m:pick(report.at5m),
  at10m:pick(report.at10m),at15m:pick(report.at15m),at30m:pick(report.at30m),
  first5mClose:pick(report.aligned5m.close1),
  second5mClose:pick(report.aligned5m.close2),
  third5mClose:pick(report.aligned5m.close3),
  before5m:report.before5m,before15m:report.before15m,
  firstFavorable10bps:report.firstFavorable10bps};
}
export function summarizeConfirmedDirectionArchive(rows,now=Date.now()){
 const periods={};
 for(const days of [30,90]){
  const subset=rows.filter(r=>r.sentAt>now-days*DAY&&r.sentAt<=now);
  const report=summarizeForecastArchive(subset,now).windows[days];
  const byDirection={};
  for(const direction of ['LONG','SHORT']){
   const group=subset.filter(r=>r.direction===direction);
   byDirection[direction]=slim(summarizeForecastArchive(group,now).windows[days]);
  }
  const byLevel={};
  for(const level of ['STANDARD','STRONG']){
   const group=subset.filter(r=>r.strength===level);
   byLevel[level]=slim(summarizeForecastArchive(group,now).windows[days]);
  }
  periods[days]={...slim(report),byDirection,byLevel};
 }
 return {archivedConfirmedDirections:rows.length,windows:periods,
  source:'Only confirmed LONG/SHORT WEEX alerts actually sent to primary ntfy topic, via existing quality route',
  directionDefinition:'Direction after alert price on completed WEEX 1m candles, and next three 5m chart closes (not execution P&L).',
  lagDefinition:'Pre-alert price change in side direction over prior completed 5m/15m history; positive already moved means possible late entry.',
  caveat:'Directional observation is not an actual fill, TP/SL touch, win rate after fees or guaranteed trade. New study cannot retroactively restore missing market data.'};
}
