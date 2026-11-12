// Research-only snapshot comparison for the proposed STRONG level gate.
// Closed WEEX 5m/15m bars, same historical candidate & NEXT 5m open proxy in
// both arms. Actual sent early ntfy notices cannot be reconstructed here.
import {_test as radar} from './signals.mjs';
import {marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
import {normalizeBacktestCandles,simulateOutcome,HOLD_BARS,FIVE_MINUTES,FIFTEEN_MINUTES} from '../lib/strategy-backtest.mjs';
import {checkStrongLevelRoom} from '../lib/two-stage-confirmation.mjs';

const ENDPOINT='https://api-contract.weex.com/capi/v3/market/klines';
const MAX_BODY=650000;
const round=(v,d=1)=>v===null?null:Number(v.toFixed(d));
const pct=(n,d)=>d?round(100*n/d):null;
async function candles(symbol,interval,limit){
 const response=await fetch(ENDPOINT+'?symbol='+encodeURIComponent(symbol)+
  '&interval='+interval+'&limit='+limit,{
  signal:AbortSignal.timeout(9000),cache:'no-store',
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-RESEARCH/1.0'}});
 if(!response.ok)throw Error('WEEX_HTTP_'+response.status);
 const body=await response.text();
 if(body.length>MAX_BODY)throw Error('WEEX_TOO_LARGE');
 const rows=JSON.parse(body);
 return Array.isArray(rows)?rows:rows?.data;
}
function stats(rows){
 const n=rows.length;
 const result={count:n,byDirection:{
  LONG:rows.filter(x=>x.direction==='LONG').length,
  SHORT:rows.filter(x=>x.direction==='SHORT').length
 }};
 for(const h of [1,3,6]){
  const valid=rows.filter(x=>Number.isFinite(x['f'+h]));
  const good=valid.filter(x=>x['f'+h]>0).length;
  result['after'+h*5+'m']={observed:valid.length,favorable:good,
   adverse:valid.filter(x=>x['f'+h]<0).length,flat:valid.filter(x=>x['f'+h]===0).length,
   favorablePct:pct(good,valid.length)};
 }
 const resolved=rows.filter(x=>x.outcome==='TP'||x.outcome==='SL');
 result.oneHourProxy={
  resolved:resolved.length,TP:resolved.filter(x=>x.outcome==='TP').length,
  SL:resolved.filter(x=>x.outcome==='SL').length,
  ambiguous:rows.filter(x=>x.outcome==='AMBIGUOUS').length,
  timeouts:rows.filter(x=>x.outcome==='TIMEOUT').length,
  tpPct:pct(resolved.filter(x=>x.outcome==='TP').length,resolved.length)};
 return result;
}
export function replayStrongLevels(five,fifteen){
 if(!Array.isArray(five)||five.length<80||
    !Array.isArray(fifteen)||fifteen.length<60)
  return {available:false,reason:'INSUFFICIENT_WEEX_HISTORY'};
 const baseline=[],kept=[],excluded=[],normal=[];
 let inspected=0,skipped=0,rawSetups=0;
 let cursor=0;
 for(let i=59;i+HOLD_BARS<five.length;i++){
  const bar=five[i],future=five.slice(i+1,i+HOLD_BARS+1);
  if(future.length!==HOLD_BARS){skipped++;continue}
  let continuity=true;
  for(let k=Math.max(1,i-59);k<=i;k++)
   if(five[k].time!==five[k-1].time+FIVE_MINUTES){continuity=false;break}
  for(let k=1;k<future.length;k++)
   if(future[k].time!==future[k-1].time+FIVE_MINUTES)continuity=false;
  if(future[0].time!==bar.closeTime)continuity=false;
  while(cursor<fifteen.length&&fifteen[cursor].closeTime<=bar.closeTime)cursor++;
  if(cursor<60||!continuity){skipped++;continue}
  const f=five.slice(Math.max(0,i-124),i+1);
  const t=fifteen.slice(Math.max(0,cursor-124),cursor);
  for(let j=1;j<t.length;j++)
   if(t[j].time!==t[j-1].time+FIFTEEN_MINUTES)continuity=false;
  if(!continuity){skipped++;continue}
  inspected++;
  const nextOpen=future[0].open;
  const s=radar.getAnalysis(f,t,nextOpen,bar.closeTime+1000);
  if(!s.direction)continue;
  rawSetups++;
  const direction=s.direction;
  const outcome=simulateOutcome({
   direction,entry:nextOpen,stop:s.stop,take:s.take,future
  });
  const sign=direction==='LONG'?1:-1;
  const record={direction,closedAt:bar.closeTime,levelBefore:s.level,
   outcome:outcome.status,...Object.fromEntries([1,3,6].map(h=>[
    'f'+h,round(10000*sign*(future[h-1].close-nextOpen)/nextOpen,2)]))};
  if(s.level!=='STRONG'){normal.push(record);continue;}
  baseline.push(record);
  const gate=checkStrongLevelRoom(s);
  if(gate.ok)kept.push(record);
  else excluded.push({...record,reason:gate.reason});
 }
 const rejectedByReason=Object.fromEntries([...new Set(excluded.map(x=>x.reason))].map(k=>
  [k,excluded.filter(x=>x.reason===k).length]));
 return {available:true,
  inspectedClosedFiveMinuteCandles:inspected,skippedForHistory:skipped,
  existingConfirmedCandidates:rawSetups,
  ordinaryAfterScore:normal.length,
  potentialStrongBeforePublishedEarlyProof:baseline.length,
  strongAfterProposedLevelGate:kept.length,
  strongDowngraded:excluded.length,rejectedByReason,
  before:stats(baseline),kept:stats(kept),downgraded:stats(excluded),
  noLookAhead:true,actualEarlyNtfyPairingNotReplayed:true,
  noOrders:true,noNotificationChanges:true};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol;
 if(typeof symbol!=='string'||!marketForecastProfile(symbol))
  return res.status(400).json({error:'Unsupported WEEX research symbol'});
 try{
  const [body5,body15]=await Promise.all([candles(symbol,'5m',576),
    candles(symbol,'15m',260)]);
  const now=Date.now();
  const five=normalizeBacktestCandles(body5,'5m',now);
  const fifteen=normalizeBacktestCandles(body15,'15m',now);
  if(!five.length||!fifteen.length||
     now-five.at(-1).closeTime>10*60000||
     now-fifteen.at(-1).closeTime>30*60000)
    throw Error('STALE_OHLC');
  return res.status(200).json({
   symbol,assetGroup:marketForecastProfile(symbol).group,
   source:'public closed WEEX 5m/15m candles',
   sample:{fiveBars:five.length,fifteenBars:fifteen.length,
    oldestFive:five[0].time,newestFive:five.at(-1).closeTime},
   ...replayStrongLevels(five,fifteen),
   assumptions:'Same historical 5m scanner and next 5m OPEN proxy in both arms. Full live STRONG also needs actually delivered prior ordinary alert, updated quote, ntfy and cost rules, which are NOT historically reconstructed. 5/15/30m directional outcomes and 60m simulated TP/SL are NOT executed trades. Small, correlated samples and no independent future validation.'});
 }catch(e){
  console.warn('WEEX_STRONG_LEVEL_REPLAY '+symbol+' '+String(e?.message||e).slice(0,70));
  return res.status(503).json({available:false,symbol,reason:'WEEX_REPLAY_UNAVAILABLE',ordersSent:0});
 }
}
