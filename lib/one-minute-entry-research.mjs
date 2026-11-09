// READ-ONLY preregistered 1m discovery research. It never produces an order,
// trading permission, ntfy alert, or modifications to the live 5m scanner.
// Every higher-timeframe candle is required to close BEFORE the 1m trigger.
import {_test as radar} from '../api/signals.mjs';
import {assessNetCosts} from './net-costs.mjs';
import {closestOpposingPivot,checkEntryLevels} from './entry-quality.mjs';
import {ACTIVE_STRATEGY} from './strategy-profile.mjs';
import {simulateOutcome} from './strategy-backtest.mjs';

export const MINUTE=60_000, FIVE=300_000, FIFTEEN=900_000, HOLD_MINUTES=60;
export const ONE_MINUTE_RESEARCH=Object.freeze({
 breakoutBars:12, volumeMin:1.15, rsiLong:[52,72],rsiShort:[28,48],
 maxOpposingWick:0.35, minBodyFraction:0.25,
 stopAtr5:ACTIVE_STRATEGY.stopAtr,takeAtr5:ACTIVE_STRATEGY.takeAtr,
 minNetRR:ACTIVE_STRATEGY.minNetRR,
 maxRiskUsdt:10,notionalUsdt:500,oneHourTimeout:true
});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const good=x=>finite(x)&&x>0;
const round=(x,n=3)=>Number(x.toFixed(n));

export function normalizeOneMinute(rows,now=Date.now()){
 if(!Array.isArray(rows)||rows.length>2000)throw Error('BAD_1M_CANDLES');
 const unique=new Map();
 for(const raw of rows){
  if(!Array.isArray(raw)||raw.length<6)continue;
  const [time,open,high,low,close,volume]=raw.slice(0,6).map(Number);
  if(!Number.isSafeInteger(time)||time<=0||time%MINUTE!==0||
   time>now-MINUTE||time+MINUTE>now-1000||
   time<now-30*86_400_000||!good(open)||!good(low)||!good(close)||
   !good(high)||!finite(volume)||volume<0||
   high<Math.max(open,close)||low>Math.min(open,close))continue;
  unique.set(time,{time,closeTime:time+MINUTE,open,high,low,close,volume});
 }
 return [...unique.values()].sort((a,b)=>a.time-b.time);
}
function continuous(rows){
 return rows.every((c,i)=>i===0||c.time===rows[i-1].closeTime);
}
function contextTrend(c,period){
 const prices=c.map(x=>x.close),fast=radar.ema(prices,20),slow=radar.ema(prices,50);
 const last=c.at(-1);
 return last.close>fast&&fast>slow?'LONG':last.close<fast&&fast<slow?'SHORT':null;
}
export function evaluateOneMinuteDiscovery(one,five,fifteen){
 if(![one,five,fifteen].every(Array.isArray)||
  one.length<60||five.length<60||fifteen.length<60||
  !continuous(one.slice(-60))||!continuous(five.slice(-60))||
  !continuous(fifteen.slice(-60)))return {stage:'INSUFFICIENT_CLOSED_DATA'};
 const last=one.at(-1),prev=one.at(-2);
 const trend5=contextTrend(five,5),trend15=contextTrend(fifteen,15);
 if(!trend5||trend5!==trend15)return {stage:'TREND_MISMATCH'};
 const prevRange=one.slice(-13,-1),prevPrevious=one.slice(-14,-2);
 if(prevPrevious.length<12)return {stage:'NO_BREAK'};
 const upper=Math.max(...prevRange.map(x=>x.high)),lower=Math.min(...prevRange.map(x=>x.low));
 const priorHigh=Math.max(...prevPrevious.map(x=>x.high)),
  priorLow=Math.min(...prevPrevious.map(x=>x.low));
 const rsi=radar.rsi(one.map(x=>x.close));
 const volumeAvg=one.slice(-21,-1).reduce((s,x)=>s+x.volume,0)/20,
  volumeRatio=volumeAvg>0?last.volume/volumeAvg:0;
 const long=trend5==='LONG'&&last.close>upper&&prev.close<=priorHigh&&rsi>=52&&rsi<=72;
 const short=trend5==='SHORT'&&last.close<lower&&prev.close>=priorLow&&rsi>=28&&rsi<=48;
 const direction=long?'LONG':short?'SHORT':null;
 if(!direction)return {stage:'NO_BREAK'};
 if(volumeRatio<ONE_MINUTE_RESEARCH.volumeMin)return {stage:'LOW_VOLUME',direction};
 const range=last.high-last.low;
 if(range<=0)return {stage:'CANDLE',direction};
 const rejectingWick=direction==='LONG'?(last.high-last.close)/range:
  (last.close-last.low)/range;
 if(rejectingWick>ONE_MINUTE_RESEARCH.maxOpposingWick||
    Math.abs(last.close-last.open)/range<ONE_MINUTE_RESEARCH.minBodyFraction||
    !radar.breakoutQuality(direction,last,upper,lower,
      radar.ema(one.map(x=>x.close),20),radar.atr(one)).ok)
   return {stage:'CANDLE',direction};
 return {stage:'FOUND',direction,signalClose:last.close,
  signalCloseTime:last.closeTime,volumeRatio:round(volumeRatio,2),
  rsi:round(rsi,1),atr5:radar.atr(five)};
}

function outcome1m(direction,entry,stop,take,bars,{feeBps,slippageBps}){
 // Re-use the existing identical 60-bar TP/SL/gap/commission simulator.
 // Its HOLD_BARS is 12; for 1m use 5-minute aggregates ONLY to preserve
 // 60-minute outcome, or an explicit independent OHLC simulator below.
 const side=direction==='LONG'?1:-1,risk=Math.abs(entry-stop);
 let exit=bars.at(-1)?.close,status='TIMEOUT';
 for(const c of bars){
  if(!c||![c.open,c.high,c.low,c.close].every(good)||
   c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close))
   return {status:'NO_DATA',grossR:null,netR:null};
  if(side*(c.open-stop)<=0){status='SL';exit=c.open;break;}
  if(side*(c.open-take)>=0){status='TP';exit=c.open;break;}
  const sl=side===1?c.low<=stop:c.high>=stop;
  const tp=side===1?c.high>=take:c.low<=take;
  if(sl&&tp)return {status:'AMBIGUOUS',grossR:null,netR:null};
  if(sl){status='SL';exit=stop;break;}
  if(tp){status='TP';exit=take;break;}
 }
 const slippage=slippageBps/10000,fee=feeBps/10000;
 const entryFill=entry*(1+side*slippage),exitFill=exit*(1-side*slippage);
 const grossR=side*(exit-entry)/risk;
 const netR=(side*(exitFill-entryFill)-fee*(entryFill+exitFill))/risk;
 return {status,grossR:round(grossR,4),netR:round(netR,4)};
}

function summarize(rows){
 let tp=0,sl=0,timeout=0,ambiguous=0,netR=0,usable=0,positive=0;
 for(const r of rows){
  if(r.status==='TP')tp++;
  if(r.status==='SL')sl++;
  if(r.status==='TIMEOUT')timeout++;
  if(r.status==='AMBIGUOUS')ambiguous++;
  if(finite(r.netR)){netR+=r.netR;usable++;if(r.netR>0)positive++;}
 }
 return {setups:rows.length,TP:tp,SL:sl,TIMEOUT:timeout,AMBIGUOUS:ambiguous,
  modeledPositive:positive,usable,
  TPShareResolvedPct:tp+sl?round(100*tp/(tp+sl),1):null,
  netSumR:usable?round(netR):null,
  netMeanR:usable?round(netR/usable):null};
}
export function replayOneMinute(one,five,fifteen,{feeBps=8,slippageBps=3}={}){
 if(![one,five,fifteen].every(Array.isArray)||one.length<150||
  five.length<70||fifteen.length<70||
  ![feeBps,slippageBps].every(finite)||feeBps<0||feeBps>25||
  slippageBps<0||slippageBps>50)throw Error('INSUFFICIENT_1M_TEST_DATA');
 let checked=0,triggered=0,barGaps=0,unavailableHTF=0;
 let skipQuote=0,skipLevels=0,skipCosts=0,skipRisk=0,skipOther=0;
 const stages={},rows=[];
 let c5=0,c15=0;
 for(let i=70;i<one.length-HOLD_MINUTES;i++){
  const bar=one[i],next=one[i+1];
  if(next?.time!==bar.closeTime){barGaps++;continue;}
  let contiguous=true;
  for(let z=i-60;z<=i+HOLD_MINUTES;z++)if(z>i-60&&
    one[z]?.time!==one[z-1]?.closeTime){contiguous=false;break}
  if(!contiguous){barGaps++;continue;}
  while(c5<five.length&&five[c5].closeTime<=bar.closeTime)c5++;
  while(c15<fifteen.length&&fifteen[c15].closeTime<=bar.closeTime)c15++;
  if(c5<60||c15<60){unavailableHTF++;continue;}
  const f=five.slice(Math.max(0,c5-125),c5),t=fifteen.slice(Math.max(0,c15-125),c15);
  const oneWindow=one.slice(Math.max(0,i-124),i+1);
  checked++;
  const found=evaluateOneMinuteDiscovery(oneWindow,f,t);
  stages[found.stage]=(stages[found.stage]||0)+1;
  if(found.stage!=='FOUND')continue;
  triggered++;
  const {direction,atr5}=found;
  const price=next.open;
  // Compare with contemporaneous next 1m OPEN, not the current 1m close.
  // This approximates quote at the next signal-dispatch opportunity.
  if(!radar.currentPriceQuality(direction,bar.close,radar.atr(oneWindow),price).ok){
   skipQuote++;continue;
  }
  const stop=direction==='LONG'?bar.close-1.2*atr5:bar.close+1.2*atr5;
  const take=direction==='LONG'?bar.close+3*atr5:bar.close-3*atr5;
  const nearest=closestOpposingPivot(f,direction,price,take);
  const level=checkEntryLevels({direction,entry:price,stop,take,nearestLevel:nearest});
  if(!level.ok){skipLevels++;continue;}
  const cost=assessNetCosts({exchange:'WEEX',direction,entryMid:price,
   bid:price,ask:price,stop,take,feeBpsEachSide:feeBps,
   slippageBpsEachSide:slippageBps});
  if(!cost||cost.netTargetBps<=0||cost.netRR<ONE_MINUTE_RESEARCH.minNetRR){
   skipCosts++;continue;
  }
  const grossRisk=500*Math.abs(price-stop)/price;
  const netRisk=500*cost.netStopLossBps/10000;
  if(grossRisk>10||netRisk>10||grossRisk<=0||netRisk<=0){
   skipRisk++;continue;
  }
  // Full 60 future 1m bars checked for continuity above. Include next
  // 1m entry bar, but never use the trigger bar's high/low for scoring.
  const result=outcome1m(direction,price,stop,take,
   one.slice(i+1,i+1+HOLD_MINUTES),{feeBps,slippageBps});
  if(result.status==='NO_DATA'){skipOther++;continue}
  rows.push({direction,status:result.status,netR:result.netR,grossR:result.grossR});
 }
 return {
  mode:'RESEARCH_ONLY_ONE_MINUTE',ordersSent:0,liveActivation:false,
  rules:ONE_MINUTE_RESEARCH,
  source:'WEEX closed 1m, 5m, 15m futures candles, only completed HTF bars as of signal',
  coverage:{one:one.length,five:five.length,fifteen:fifteen.length,
   checked,barGaps,unavailableHTF},
  filter:{stages,triggered,skipQuote,skipLevels,skipCosts,skipRisk,skipOther},
  results:summarize(rows),
  limitations:[
   'Post-close next-minute OPEN is an execution proxy, not a guaranteed quote/fill.',
   'Bid/ask spread modeled as ZERO (optimistic); funding, orderbook, latency and capacity omitted.',
   'Correlated signals can overlap; no portfolio, liquidation or account P&L simulation.',
   'Prior historical candles cannot prove future profitability; check unseen periods before live use.'
  ]
 };
}
