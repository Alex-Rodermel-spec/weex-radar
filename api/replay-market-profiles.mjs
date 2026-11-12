// ONE-OFF ISOLATED PREVIEW RESEARCH: not imported by production dispatch.
// Replays exact live 1m/5m/10m forecast and V2/arrival logic at 10-minute
// boundaries using *only past closed WEEX candles* at each historic instant.
// Compares #100 (fixed 10 bps fast-chase gate) vs #101 (instrument-adaptive).
// Does not place trades, write storage, publish alerts, or fetch account data.
// Intended for one-time short-window analysis, not a profitable backtest.
import {buildStandaloneForecast} from '../lib/standalone-forecast.mjs';
import {forecastEligible} from '../lib/forecast-ntfy.mjs';
import {forecastDeliveryDecision} from '../lib/forecast-arrival-safeguard.mjs';
import {_test as markets} from './signals.mjs';
const ONE=60_000,FIVE=5*ONE,TEN=10*ONE;
const URL='https://api-contract.weex.com/capi/v3/market/klines';
function safeRows(raw,delta,now){
 if(!Array.isArray(raw))return [];
 const map=new Map();
 for(const r of raw){
  if(!Array.isArray(r)||r.length<6)continue;
  const nums=r.slice(0,6).map(Number);
  const [time,open,high,low,close,volume]=nums;
  if(!nums.every(Number.isFinite)||!Number.isSafeInteger(time)||
   time%delta!==0||time+delta>now-1000||time<now-3*86_400_000||
   open<=0||close<=0||low<=0||high<Math.max(open,close,low)||
   low>Math.min(open,close)||volume<0)continue;
  map.set(time,{time,closeTime:time+delta,open,high,low,close,volume});
 }
 return [...map.values()].sort((a,b)=>a.time-b.time);
}
async function klines(symbol,interval,limit){
 const url=URL+'?symbol='+encodeURIComponent(symbol)+
  '&interval='+interval+'&limit='+limit;
 const response=await fetch(url,{
  signal:AbortSignal.timeout(9500),cache:'no-store',
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-READONLY-ONEOFF-REPLAY/1.0'}});
 if(!response.ok)throw Error('WEEX_HTTP_'+response.status);
 const body=await response.text();
 if(body.length>700000)throw Error('WEEX_TOO_LARGE');
 const parsed=JSON.parse(body);
 return Array.isArray(parsed)?parsed:parsed?.data;
}
function consecutive(rows,n,duration){
 return rows.length>=n&&rows.every((x,i)=>i===0||
   x.time===rows[i-1].closeTime&&x.closeTime-x.time===duration);
}
function indexToTime(arr,t){
 const k=arr.findIndex(x=>x.closeTime===t);
 return k;
}
const bps=(direction,a,b)=>Math.round(10_000*(direction==='LONG'?1:-1)*(b-a)/a*10)/10;
function event(symbol,snap,one,minute,t){
 const quality=snap.strengthRisk?.level;
 const direction=snap.combinedDirection==='LONG_BIAS'?'LONG':'SHORT';
 const v=snap.strongV2Review;
 const v2Late=v?.sampleReady===true&&v.status==='REVIEW_DOWNGRADE'&&
  ['STRONG','STANDARD'].includes(v.baselineLevel)&&
  quality===v.baselineLevel;
 const fast=snap.arrivalTiming;
 const oldLate=v2Late||fast?.sampleReady===true&&fast.legacyLateRisk===true;
 const newLate=forecastDeliveryDecision(snap).status==='SUPPRESS_LATE';
 const s=direction==='LONG'?1:-1;
 const ref=one.at(-1).close;
 const at5=minute.get(t+5*ONE),at15=minute.get(t+15*ONE);
 const pre=minute.get(t-15*ONE);
 const pre15Bps=pre?Math.round(s*(ref-pre.close)/pre.close*10000*10)/10:null;
 const rel=one.at(-1).volume;
 return {t,symbol,direction,strength:quality,ref,
  rank:(quality==='STRONG'?3:quality==='STANDARD'?2:quality==='CAUTION'?1:0)*10+
   (snap.timeframes?.[0]?.relativeVolume||0)+
   (snap.timeframes||[]).reduce((sum,f)=>sum+(f.voteAgreement||0)*.15,0),
  v2Late,oldLate,newLate,adaptive:fast?.adaptiveReady===true,
  pre1Bps:fast?.preMove1mBps,pre3Bps:fast?.preMove3mBps,
  pre15Bps,oldThreshold:10,thr1:fast?.threshold1mBps,
  thr3:fast?.threshold3mBps,
  bps5:at5?bps(direction,ref,at5.close):null,
  bps15:at15?bps(direction,ref,at15.close):null};
}
async function scan(symbol,now){
 const [oneRaw,fiveRaw]=await Promise.all([
  klines(symbol,'1m',1000),klines(symbol,'5m',350)
 ]);
 const one=safeRows(oneRaw,ONE,now),five=safeRows(fiveRaw,FIVE,now);
 const counts={m1:one.length,m5:five.length,checked:0,eligible:0,
  insufficient:0,unaligned:0,oldLate:0,newLate:0};
 const events=[];
 if(one.length<155||five.length<125)return {symbol,counts,events,
  error:'INSUFFICIENT_RAW'};
 const minute=new Map(one.map(x=>[x.closeTime,x]));
 const earliest=Math.max(one[124].closeTime,five[124].closeTime);
 const start=Math.ceil(earliest/TEN)*TEN;
 const end=Math.floor((now-16*ONE)/TEN)*TEN;
 for(let t=start;t<=end;t+=TEN){
  const i=indexToTime(one,t),j=indexToTime(five,t);
  if(i<124||j<124)continue;
  const oneSlice=one.slice(i-124,i+1),fiveSlice=five.slice(j-124,j+1);
  if(!consecutive(oneSlice,125,ONE)||!consecutive(fiveSlice,125,FIVE)){
   counts.insufficient++;continue;
  }
  counts.checked++;
  const snap=buildStandaloneForecast(oneSlice,fiveSlice,t+30000,symbol);
  if(!snap.available) {counts.insufficient++;continue}
  const d={...snap,symbol,exchange:'WEEX'};
  if(d.alignment!=='THREE_TIMEFRAME_ALIGNMENT')counts.unaligned++;
  if(!forecastEligible(d,t+30000))continue;
  counts.eligible++;
  const e=event(symbol,d,oneSlice,minute,t);
  counts.oldLate+=Number(e.oldLate);counts.newLate+=Number(e.newLate);
  events.push(e);
 }
 return {symbol,counts,events};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbols=typeof req.query?.symbols==='string'?
  req.query.symbols.split(','):[];
 if(symbols.length<1||symbols.length>4||
  new Set(symbols).size!==symbols.length||
  symbols.some(s=>!markets.FORECAST_SYMBOLS.includes(s)))
  return res.status(400).json({error:'Choose 1-4 unique supported WEEX symbols'});
 try{
  const now=Date.now();
  const results=await Promise.all(symbols.map(s=>scan(s,now).catch(e=>({
   symbol:s,events:[],counts:{},error:String(e?.message||e).slice(0,80)
  }))));
  return res.status(200).json({
   mode:'ONEOFF_REPLAY_V100_V101',isResearchOnly:true,
   generatedAt:now,versions:['#100 fixed 10bps','#101 per-market normalized 1m/3m'],
   protocol:'Latest ~14h of public WEEX 1m+5m candles; 10m-aligned decisions; 125 past closed candles per frame; indicators and ntfy eligibility from live modules; identical forecast directions. No 30m dedupe or global 2-slot selection in per-market rows; aggregate these externally. Future 5m/15m close checked AFTER decision; excludes 16m recent to avoid pending. Pre-15m movement is a proxy for already moving, not proof of actual first move. No orderbook, fees or delivery latency.',
   results
  });
 }catch(e){
  return res.status(503).json({error:'Replay unavailable',detail:String(e?.message||e).slice(0,70)});
 }
}
