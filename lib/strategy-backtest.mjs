// RESEARCH ONLY: closed-candle historical replay, never an order or alert.
// Uses exactly the live radar's candidate conditions and live filter function;
// the historical "current quote" is approximated by the NEXT 5m open.
// This is not an executable simulation, calibrated win probability or forecast.
import {_test as radar} from '../api/signals.mjs';

export const FIVE_MINUTES=300_000;
export const FIFTEEN_MINUTES=900_000;
export const HOLD_BARS=12;
export const DEFAULT_FEE_BPS=8; // illustrative taker 0.08% each way
export const DEFAULT_SLIPPAGE_BPS=3; // assumed 0.03% each way
const valid=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,d=3)=>x===null?null:Number(x.toFixed(d));
const dirs=['LONG','SHORT'];

export function normalizeBacktestCandles(rows,interval,now=Date.now()){
 const duration=interval==='5m'?FIVE_MINUTES:
   interval==='15m'?FIFTEEN_MINUTES:null;
 if(!duration||!Array.isArray(rows)||rows.length>1000)throw Error('BAD_KLINES');
 const byTime=new Map();
 for(const row of rows){
  if(!Array.isArray(row)||row.length<6)continue;
  const [time,open,high,low,close,volume]=row.slice(0,6).map(Number);
  if(![time,open,high,low,close,volume].every(valid)||
    !Number.isSafeInteger(time)||time<=0||time>now-duration||
    time<now-60*86_400_000||time+duration>now-1000||
    open<=0||high<Math.max(open,close)||low>Math.min(open,close)||
    low<=0||volume<0)continue;
  byTime.set(time,{time,closeTime:time+duration,open,high,low,close,volume});
 }
 return [...byTime.values()].sort((a,b)=>a.time-b.time);
}

function historicalCandidate(five,fifteen){
 if(five.length<60||fifteen.length<60)return null;
 const last=five.at(-1),c5=five.map(c=>c.close),c15=fifteen.map(c=>c.close);
 const e20=radar.ema(c5,20),e50=radar.ema(c5,50);
 const t20=radar.ema(c15,20),t50=radar.ema(c15,50);
 const r=radar.rsi(c5);
 const previous=five.slice(-13,-1);
 const upper=Math.max(...previous.map(c=>c.high)),
  lower=Math.min(...previous.map(c=>c.low));
 const longTrend=e20>e50&&t20>t50&&fifteen.at(-1).close>t20;
 const shortTrend=e20<e50&&t20<t50&&fifteen.at(-1).close<t20;
 const longBreak=last.close>upper&&last.close>e20&&r>=55&&r<=77;
 const shortBreak=last.close<lower&&last.close<e20&&r>=23&&r<=45;
 return longTrend&&longBreak?'LONG':shortTrend&&shortBreak?'SHORT':null;
}

function sideOf(direction){return direction==='LONG'?1:-1;}
export function simulatedFill(direction,entry,exit,feeBps=DEFAULT_FEE_BPS,
 slippageBps=DEFAULT_SLIPPAGE_BPS,riskAbs){
 if(!dirs.includes(direction)||![entry,exit,feeBps,slippageBps,riskAbs].every(valid)||
   Math.min(entry,exit,riskAbs)<=0||feeBps<0||feeBps>25||
   slippageBps<0||slippageBps>50)throw Error('INVALID_COST_ASSUMPTIONS');
 const side=sideOf(direction),slip=slippageBps/10000,fee=feeBps/10000;
 const paidEntry=entry*(1+side*slip),paidExit=exit*(1-side*slip);
 const grossR=side*(exit-entry)/riskAbs;
 const commission=fee*(paidEntry+paidExit);
 const netR=(side*(paidExit-paidEntry)-commission)/riskAbs;
 return {grossR:round(grossR,4),netR:round(netR,4)};
}

export function simulateOutcome({direction,entry,stop,take,future,
 feeBps=DEFAULT_FEE_BPS,slippageBps=DEFAULT_SLIPPAGE_BPS}){
 if(!dirs.includes(direction)||![entry,stop,take].every(valid)||
  Math.min(entry,stop,take)<=0||
  (direction==='LONG'&&!(stop<entry&&entry<take))||
  (direction==='SHORT'&&!(take<entry&&entry<stop))||
  !Array.isArray(future)||future.length!==HOLD_BARS)
  return {status:'NO_DATA',grossR:null,netR:null};
 const riskAbs=Math.abs(entry-stop);
 let outcome='TIMEOUT',exit=future.at(-1).close;
 for(const bar of future){
  if(!bar||![bar.open,bar.high,bar.low,bar.close].every(valid)||
      bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))
   return {status:'NO_DATA',grossR:null,netR:null};
  const side=sideOf(direction);
  // A gap through the stop is executed at the 5m opening price, not the
  // theoretical stop. Gaps through TP are modeled at opening price too.
  if(side*(bar.open-stop)<=0){outcome='SL';exit=bar.open;break}
  if(side*(bar.open-take)>=0){outcome='TP';exit=bar.open;break}
  const hitStop=side===1?bar.low<=stop:bar.high>=stop;
  const hitTake=side===1?bar.high>=take:bar.low<=take;
  if(hitStop&&hitTake)return {status:'AMBIGUOUS',grossR:null,netR:null};
  if(hitStop){outcome='SL';exit=stop;break}
  if(hitTake){outcome='TP';exit=take;break}
 }
 const costs=simulatedFill(direction,entry,exit,feeBps,slippageBps,riskAbs);
 return {status:outcome,...costs};
}

function freshFuture(five,i){
 const start=five[i].time;
 for(let k=1;k<=HOLD_BARS;k++)
  if(five[i+k]?.time!==start+k*FIVE_MINUTES)return null;
 return five.slice(i+1,i+HOLD_BARS+1);
}
function aggregate(rows){
 const result={setups:rows.length,TP:0,SL:0,tpNetLoss:0,tpNetPositive:0,TIMEOUT:0,AMBIGUOUS:0,
  NO_DATA:0,resolved:0,winRatePct:null,netAverageR:null,
  netSumR:null,costFreeSumR:null,usable:0};
 let netSum=0,grossSum=0;
 for(const row of rows){
  if(!(row.status in result))continue;
  result[row.status]++;
  if(row.status==='TP'||row.status==='SL')result.resolved++;
  // A candle can touch the TP yet still lose money after notional fees.
  if(row.status==='TP'&&valid(row.netR)){
   if(row.netR<=0)result.tpNetLoss++;
   else result.tpNetPositive++;
  }
  if(valid(row.netR)&&valid(row.grossR)){
   result.usable++;netSum+=row.netR;grossSum+=row.grossR;
  }
 }
 result.winRatePct=result.resolved?
  round(result.TP/result.resolved*100,1):null;
 result.netAverageR=result.usable?round(netSum/result.usable):null;
 result.netSumR=result.usable?round(netSum):null;
 result.costFreeSumR=result.usable?round(grossSum):null;
 return result;
}

export function replayHistory(five,fifteen,{
 feeBps=DEFAULT_FEE_BPS,slippageBps=DEFAULT_SLIPPAGE_BPS
}={}){
 if(!Array.isArray(five)||!Array.isArray(fifteen)||
  five.length<80||fifteen.length<60||five.length>1000||
  fifteen.length>1000||![feeBps,slippageBps].every(valid)||
  feeBps<0||feeBps>25||slippageBps<0||slippageBps>50)
   throw Error('INSUFFICIENT_BACKTEST_DATA');
 const base=[],filtered=[];
 const byDirection={LONG:{base:[],filtered:[]},SHORT:{base:[],filtered:[]}};
 let inspected=0,insufficient15=0,skippedDiscontinuity=0;
 let rejectedQuality=0,excludedEntryGap=0,rawCandidates=0;
 let fifteenCursor=0;
 for(let i=59;i<five.length-HOLD_BARS;i++){
  const signal=five[i],future=freshFuture(five,i);
  if(!future){skippedDiscontinuity++;continue;}
  // Indicator windows need uninterrupted data, or "12 candles ago" might
  // actually mean a much longer period because of an exchange feed hole.
  let uninterrupted=true;
  for(let k=Math.max(1,i-59);k<=i;k++)
   if(five[k].time!==five[k-1].time+FIVE_MINUTES){
    uninterrupted=false;break;
   }
  if(!uninterrupted){skippedDiscontinuity++;continue;}
  while(fifteenCursor<fifteen.length&&
   fifteen[fifteenCursor].closeTime<=signal.closeTime)fifteenCursor++;
  if(fifteenCursor<60){insufficient15++;continue;}
  const fiveWindow=five.slice(Math.max(0,i-124),i+1);
  const fifteenWindow=fifteen.slice(Math.max(0,fifteenCursor-125),fifteenCursor);
  let continuous15=true;
  for(let k=1;k<fifteenWindow.length;k++)
   if(fifteenWindow[k].time!==fifteenWindow[k-1].time+FIFTEEN_MINUTES){
    continuous15=false;break;
   }
  if(!continuous15){skippedDiscontinuity++;continue;}
  inspected++;
  const candidate=historicalCandidate(fiveWindow,fifteenWindow);
  if(!candidate)continue;
  rawCandidates++;
  // Do not assume the next opening quote existed before candle close.
  // For both arms use the SAME next 5m open, stop and take.
  const entry=future[0].open,volatility=radar.atr(fiveWindow);
  const stop=candidate==='LONG'?signal.close-1.2*volatility:signal.close+1.2*volatility;
  const take=candidate==='LONG'?signal.close+2.4*volatility:signal.close-2.4*volatility;
  if(candidate==='LONG'?!(stop<entry&&entry<take):
    !(take<entry&&entry<stop)){excludedEntryGap++;continue;}
  const simulated=simulateOutcome({
   direction:candidate,entry,stop,take,future,feeBps,slippageBps
  });
  if(simulated.status==='NO_DATA'){skippedDiscontinuity++;continue;}
  const record={...simulated,direction:candidate};
  base.push(record);
  byDirection[candidate].base.push(record);
  // Reuse EXACTLY the current scanner's quality/sideways/entry gates.
  // Historical next-bar OPEN approximates live bid/ask midpoint, not a
  // time-stamped quote; notification latency is impossible to reconstruct.
  const checked=radar.getAnalysis(fiveWindow,fifteenWindow,entry,
    signal.closeTime+1000);
  if(checked.direction===candidate){
   filtered.push(record);
   byDirection[candidate].filtered.push(record);
  }else rejectedQuality++;
 }
 return {
  provider:'WEEX futures public 5m and 15m OHLCV',
  mode:'RESEARCH_SHADOW',
  timeframe:'5m',confirmation:'15m',horizonMinutes:60,
  candles5m:five.length,candles15m:fifteen.length,
  evaluatedCandles:inspected,rawCandidates,excludedEntryGap,
  skippedDiscontinuity,insufficient15,rejectedQuality,
  assumptions:{
   feeBpsEachSide:feeBps,slippageBpsEachSide:slippageBps,
   entry:'next completed 5m bar OPEN, approximate live quote',
   exit:'first TP/SL level touch within 12 later 5m candles; both in same bar AMBIGUOUS',
   concurrentSignals:'Independently simulated; may overlap; no account capital or portfolio backtest',
   costModel:'taker commission on entry and exit + adverse slippage on both legs; funding omitted'
  },
  sample:{start:five[0].time,end:five.at(-1).closeTime},
  baseline:aggregate(base),
  filtered:aggregate(filtered),
  directions:Object.fromEntries(dirs.map(d=>[d,{
   baseline:aggregate(byDirection[d].base),
   filtered:aggregate(byDirection[d].filtered)
  }]))
 };
}
