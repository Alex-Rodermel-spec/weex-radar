import {assessForecastStrengthRisk} from './forecast-strength-risk.mjs';
import {reviewStrongV2} from './strong-v2-review.mjs';
import {forecastShortPreMove} from './forecast-arrival-safeguard.mjs';
import {assessForecastReversalRisk} from './forecast-reversal-risk.mjs';
import {assessForecastFilterOverlap} from './forecast-filter-ablation.mjs';
// WEEX RADAR INDEPENDENT forecast reader, not a LONG/SHORT entry gate.
// Every interpretation uses completed, chronological public WEEX 1m/5m bars.
// 10m candles are formed from fully closed, aligned pairs of 5m candles.
// No account keys, orders, notification topics, paid services or writes.
const MIN=60000,FIVE=5*MIN,TEN=10*MIN;
const ENDPOINT='https://api-contract.weex.com/capi/v3/market/klines';
const MAX_BYTES=220000,MIN_ROWS=60;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,k=4)=>Number(x.toFixed(k));
const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
function ema(values,period){
 if(values.length<period)return null;
 let v=avg(values.slice(0,period));
 for(let i=period;i<values.length;i++)v=values[i]*2/(period+1)+v*(period-1)/(period+1);
 return v;
}
function rsi(values,period=14){
 if(values.length<period+1)return null;
 let gains=0,losses=0;
 for(let i=1;i<=period;i++){
  const delta=values[i]-values[i-1];
  gains+=Math.max(0,delta);losses+=Math.max(0,-delta);
 }
 gains/=period;losses/=period;
 for(let i=period+1;i<values.length;i++){
  const d=values[i]-values[i-1];
  gains=(gains*(period-1)+Math.max(0,d))/period;
  losses=(losses*(period-1)+Math.max(0,-d))/period;
 }
 return gains+losses===0?50:losses===0?100:100-100/(1+gains/losses);
}
function band(values){
 const last=values.slice(-20),mid=avg(last);
 const stdev=Math.sqrt(avg(last.map(x=>(x-mid)**2)));
 return {middle:round(mid,8),upper:round(mid+2*stdev,8),
  lower:round(mid-2*stdev,8),widthPct:round(400*stdev/mid,3),
  position:values.at(-1)>mid+2*stdev?'ABOVE_UPPER':
   values.at(-1)<mid-2*stdev?'BELOW_LOWER':
   values.at(-1)>=mid?'UPPER_HALF':'LOWER_HALF'};
}
export function completedForecastBars(raw,duration,now=Date.now()){
 if(!Array.isArray(raw)||raw.length<MIN_ROWS||raw.length>500)return [];
 const unique=new Map();
 for(const row of raw){
  if(!Array.isArray(row)||row.length<6)continue;
  const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
  if(!Number.isSafeInteger(time)||time%duration!==0||
   time+duration>now-1000||time<now-3*86400000||
   ![open,high,low,close,volume].every(finite)||
   Math.min(open,high,low,close)<=0||volume<0||
   high<Math.max(open,close,low)||low>Math.min(open,close))
   continue;
  unique.set(time,{time,closeTime:time+duration,open,high,low,close,volume});
 }
 const bars=[...unique.values()].sort((a,b)=>a.time-b.time);
 if(bars.length<MIN_ROWS||now-bars.at(-1).closeTime>duration+MIN+1000||
  bars.some((b,i)=>i>0&&b.time!==bars[i-1].closeTime))return [];
 return bars;
}
export function forecastTenMinuteBars(five,now=Date.now()){
 if(!Array.isArray(five))return [];
 const bars=[];
 for(let i=0;i+1<five.length;i++){
  const a=five[i],b=five[i+1];
  if(a.time%TEN!==0||b.time!==a.closeTime||
   b.closeTime!==a.time+TEN||b.closeTime>now-1000)continue;
  bars.push({time:a.time,closeTime:b.closeTime,open:a.open,
   high:Math.max(a.high,b.high),low:Math.min(a.low,b.low),
   close:b.close,volume:a.volume+b.volume});
  i++;
 }
 return bars;
}
function context(five,price){
 const last=five.slice(-30),left=last.slice(0,15),right=last.slice(15);
 const high0=Math.max(...left.map(x=>x.high)),high1=Math.max(...right.map(x=>x.high));
 const low0=Math.min(...left.map(x=>x.low)),low1=Math.min(...right.map(x=>x.low));
 const structure=high1>high0&&low1>low0?'HIGHER_HIGHS_LOW':
  high1<high0&&low1<low0?'LOWER_HIGHS_LOW':'RANGE_OR_MIXED';
 const swingHigh=Math.max(...last.map(x=>x.high));
 const swingLow=Math.min(...last.map(x=>x.low));
 const recentPrior=last.slice(-12,-2);
 const breakoutUp=last.at(-1).close>Math.max(...recentPrior.map(x=>x.high));
 const breakoutDown=last.at(-1).close<Math.min(...recentPrior.map(x=>x.low));
 // A recent opposite-color candle can resemble an "order block", not
 // evidence of actual large resting institutional orders.
 let candleProxy=null;
 for(let i=last.length-3;i>=last.length-12;i--){
  const candle=last[i],next=last[i+1],prior=last.slice(Math.max(0,i-6),i);
  if(!prior.length)continue;
  const shiftUp=candle.close<candle.open&&
   next.close>Math.max(...prior.map(x=>x.high));
  const shiftDown=candle.close>candle.open&&
   next.close<Math.min(...prior.map(x=>x.low));
  if(shiftUp||shiftDown){
   candleProxy={direction:shiftUp?'LONG':'SHORT',low:candle.low,high:candle.high,
    observedAt:next.closeTime,verifiedOrders:false};
   break;
  }
 }
 return {structure,observedResistance:round(swingHigh,8),
  observedSupport:round(swingLow,8),
  possibleLiquidityAbove:swingHigh>price?round(swingHigh,8):null,
  possibleLiquidityBelow:swingLow<price?round(swingLow,8):null,
  recentBreakout:breakoutUp?'UP':breakoutDown?'DOWN':'NONE',
  candleOrderBlockProxy:candleProxy,orderBookChecked:false,
  actualLiquidityUnknown:true};
}
function inspect(bars,intervalMinutes){
 if(!Array.isArray(bars)||bars.length<50)return null;
 const closes=bars.map(x=>x.close),last=bars.at(-1),r=rsi(closes);
 const fast=ema(closes,20),slow=ema(closes,50),bb=band(closes);
 const before=bars.slice(-21,-1),meanVolume=avg(before.map(x=>x.volume));
 const relVol=meanVolume>0?last.volume/meanVolume:0;
 const trend=fast>slow?'UP':fast<slow?'DOWN':'FLAT';
 const directionVotes=[trend==='UP'?1:trend==='DOWN'?-1:0,
  r>52?1:r<48?-1:0,last.close>bb.middle?1:last.close<bb.middle?-1:0];
 const score=directionVotes.reduce((s,v)=>s+v,0);
 const direction=score>=2?'LONG_BIAS':score<=-2?'SHORT_BIAS':'NEUTRAL';
 const tr=bars.slice(-14).map((x,i,a)=>i===0?x.high-x.low:
  Math.max(x.high-x.low,Math.abs(x.high-a[i-1].close),Math.abs(x.low-a[i-1].close)));
 const atr14=avg(tr);
 return {intervalMinutes,closedAt:last.closeTime,direction,trend,
  // Research-only: last FULLY CLOSED candle body color, not a forecast vote.
  lastCandleBody:last.close>last.open?'UP':last.close<last.open?'DOWN':'FLAT',
  price:round(last.close,8),ema20:round(fast,8),ema50:round(slow,8),
  rsi14:round(r,1),bollinger20:bb,relativeVolume:round(relVol,2),
  atr14:round(atr14,8),volumeState:relVol>=1.15?'ELEVATED':relVol<0.8?'QUIET':'NORMAL',
  voteAgreement:Math.abs(score),notTrade:true};
}
export function buildStandaloneForecast(one,five,now=Date.now(),symbol=null){
 const unavailable={mode:'STANDALONE_WEEX_FORECAST_1_5_10',
  available:false,notTrade:true,ordersSent:0};
 if(!Array.isArray(one)||one.length<60||!Array.isArray(five)||five.length<101||
  one.some((b,i)=>i&&b.time!==one[i-1].closeTime)||
  five.some((b,i)=>i&&b.time!==five[i-1].closeTime))
  return {...unavailable,reason:'GAPPED_OR_INSUFFICIENT'};
 const ten=forecastTenMinuteBars(five,now);
 if(ten.length<50||now-one.at(-1).closeTime>92000||
  now-five.at(-1).closeTime>11*MIN||
  now-ten.at(-1).closeTime>11*MIN)
  return {...unavailable,reason:'STALE_OR_INSUFFICIENT'};
 const m1=inspect(one,1),m5=inspect(five,5),m10=inspect(ten,10);
 if(!m1||!m5||!m10)return {...unavailable,reason:'INDICATORS_UNAVAILABLE'};
 const aligned=m1.direction!=='NEUTRAL'&&
  m1.direction===m5.direction&&m5.direction===m10.direction;
 const preferred=aligned?m5.direction:'MIXED';
 const forecast={...unavailable,available:true,generatedAt:now,
  dataSource:'WEEX_PUBLIC_CLOSED_1M_AND_5M',timeframes:[m1,m5,m10],
  primaryContext:context(five,m1.price),combinedDirection:preferred,
  alignment:aligned?'THREE_TIMEFRAME_ALIGNMENT':'MIXED_OR_CONFLICT',
  signalPermission:false,
  disclaimer:'A directional forecast is not a confirmed trade or calibrated probability. Order-block/liquidity levels are candle proxies, not an order book. LONG/SHORT entry alerts remain independent.'};
 const withReversal={...forecast,reversalRisk:assessForecastReversalRisk(forecast,one,five,symbol)};
 const result={...withReversal,strengthRisk:assessForecastStrengthRisk(withReversal)};
 const withV2={...result,strongV2Review:reviewStrongV2(result,one)};
 const withTiming={...withV2,arrivalTiming:forecastShortPreMove(withV2,one,symbol)};
 return {...withTiming,filterOverlapStudy:assessForecastFilterOverlap(withTiming)};
}
export async function fetchPublicForecastBars(symbol,interval,duration,now,fetchImpl){
 const url=ENDPOINT+'?symbol='+encodeURIComponent(symbol)+
  '&interval='+interval+'&limit=125';
 const r=await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(7000),
  headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-FORECAST-READONLY/1.0'}});
 if(!r.ok)throw Error('WEEX_FORECAST_HTTP_'+r.status);
 if(Number(r.headers?.get?.('content-length')||0)>MAX_BYTES)throw Error('WEEX_FORECAST_LARGE');
 const body=await r.text();
 if(body.length>MAX_BYTES)throw Error('WEEX_FORECAST_LARGE');
 const parsed=JSON.parse(body);
 return completedForecastBars(Array.isArray(parsed)?parsed:parsed?.data,duration,now);
}
// Internal read-only scanner shared by the separate forecast dashboard and
// 10-minute forecast ntfy channel. No API keys, order routes or storage.
export async function readStandaloneForecast(symbol,{fetchImpl=fetch,now=Date.now()}={}){
 const [one,five]=await Promise.all([
  fetchPublicForecastBars(symbol,'1m',MIN,now,fetchImpl),
  fetchPublicForecastBars(symbol,'5m',FIVE,now,fetchImpl)]);
 const result=buildStandaloneForecast(one,five,now,symbol);
 if(!result.available)throw Error(result.reason||'NO_FORECAST');
 return {...result,symbol,exchange:'WEEX'};
}
export async function handleStandaloneForecast(req,res,allowed,{fetchImpl=fetch,now=Date.now()}={}){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const symbol=req.query?.symbol;
 if(typeof symbol!=='string'||!Array.isArray(allowed)||!allowed.includes(symbol))
  return res.status(400).json({error:'Unsupported WEEX forecast market'});
 try{
  return res.status(200).json(await readStandaloneForecast(symbol,{fetchImpl,now}));
 }catch(e){
  console.warn('WEEX_FORECAST_READONLY_UNAVAILABLE '+
   symbol+' '+String(e.message||e).slice(0,100));
  return res.status(503).json({mode:'STANDALONE_WEEX_FORECAST_1_5_10',
   symbol,error:'Closed WEEX 1m/5m data unavailable or incomplete',
   available:false,notTrade:true,ordersSent:0});
 }
}
