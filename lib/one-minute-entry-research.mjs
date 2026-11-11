// READ-ONLY preregistered 1m discovery research. It never produces an order,
// trading permission, ntfy alert, or modifications to the live 5m scanner.
// Every higher-timeframe candle is required to close BEFORE the 1m trigger.
import {_test as radar} from '../api/signals.mjs';
import {assessNetCosts} from './net-costs.mjs';
import {closestOpposingPivot,checkEntryLevels,MIN_REWARD_RISK,MIN_STRUCTURAL_ROOM_R} from './entry-quality.mjs';
import {ACTIVE_STRATEGY} from './strategy-profile.mjs';

export const MINUTE=60_000, FIVE=300_000, FIFTEEN=900_000, HOLD_MINUTES=60;
export const ONE_MINUTE_RESEARCH=Object.freeze({
 breakoutBars:12, volumeMin:1.15, rsiLong:[52,72],rsiShort:[28,48],
 bollingerPeriod:20,bollingerDeviations:2,maxBandExtensionAtr:0.85,
 maxOpposingWick:0.35, minBodyFraction:0.25,
 stopAtr5:ACTIVE_STRATEGY.stopAtr,takeAtr5:ACTIVE_STRATEGY.takeAtr,
 minNetRR:ACTIVE_STRATEGY.minNetRR,
 maxRiskUsdt:10,notionalUsdt:500,oneHourTimeout:true
});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const good=x=>finite(x)&&x>0;
const round=(x,n=3)=>Number(x.toFixed(n));

// Identify which existing entry gate rejected the candidate.
// Aggregates only: no private or individual trade data.
export function classifyEntryRejection(level){
 if(level?.ok===true)return null;
 // Use the exact source-gate decision before rounded public RR values:
 // 1.495R might be shown as 1.50R but is still correctly rejected.
 if(level?.reason?.startsWith('При текущей цене прибыль/риск ниже'))
  return 'REWARD_RISK';
 if(level?.reason?.startsWith('Ближайший локальный уровень ближе'))
  return 'NEAR_PIVOT';
 if(!finite(level?.rr)||level.rr<=0)return 'INVALID_LEVELS';
 if(level.rr<MIN_REWARD_RISK)return 'REWARD_RISK';
 if(finite(level.roomR)&&level.roomR<MIN_STRUCTURAL_ROOM_R)return 'NEAR_PIVOT';
 return 'OTHER_LEVELS';
}
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
 if(five.at(-1).closeTime>one.at(-1).closeTime||
   fifteen.at(-1).closeTime>one.at(-1).closeTime)return {stage:'FUTURE_CONTEXT'};
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

// Second preregistered idea: a 1m EMA20 reclaim AFTER a pullback,
// in the direction of ALREADY closed 5m/15m EMA20/50 trend.
// It does not buy a new breakout candle or use future prices.
export function evaluateOneMinutePullback(one,five,fifteen){
 if(![one,five,fifteen].every(Array.isArray)||
   one.length<60||five.length<60||fifteen.length<60||
   !continuous(one.slice(-60))||!continuous(five.slice(-60))||
   !continuous(fifteen.slice(-60)))return {stage:'INSUFFICIENT_CLOSED_DATA'};
 if(five.at(-1).closeTime>one.at(-1).closeTime||
   fifteen.at(-1).closeTime>one.at(-1).closeTime)return {stage:'FUTURE_CONTEXT'};
 const trend5=contextTrend(five,5),trend15=contextTrend(fifteen,15);
 if(!trend5||trend5!==trend15)return {stage:'TREND_MISMATCH'};
 const direction=trend5,prev=one.at(-2),last=one.at(-1);
 const prices=one.map(x=>x.close);
 const emaNow=radar.ema(prices,20),emaPrev=radar.ema(prices.slice(0,-1),20);
 const r=radar.rsi(prices);
 const volumeAvg=one.slice(-21,-1).reduce((s,x)=>s+x.volume,0)/20;
 const volumeRatio=volumeAvg>0?last.volume/volumeAvg:0;
 // Previous complete 1m bar on opposite side of EMA, current complete
 // 1m bar closes back over EMA in trend direction (no forward look).
 const reclaimed=direction==='LONG'?
  prev.close<=emaPrev&&last.close>emaNow&&last.close>last.open:
  prev.close>=emaPrev&&last.close<emaNow&&last.close<last.open;
 if(!reclaimed)return {stage:'NO_PULLBACK_RECLAIM'};
 if(volumeRatio<0.85)return {stage:'LOW_VOLUME',direction};
 if(direction==='LONG'?(r<45||r>70):(r<30||r>55))
  return {stage:'RSI',direction};
 const range=last.high-last.low;
 if(range<=0)return {stage:'CANDLE',direction};
 const wick=direction==='LONG'?(last.high-last.close)/range:
  (last.close-last.low)/range;
 if(wick>0.45||Math.abs(last.close-last.open)/range<0.2)
  return {stage:'CANDLE',direction};
 const atr1=radar.atr(one),atr5=radar.atr(five);
 if(!good(atr1)||!good(atr5)||Math.abs(last.close-emaNow)>0.65*atr1||
  range>2.5*atr1)return {stage:'EXTENDED',direction};
 return {stage:'FOUND',direction,signalClose:last.close,
  signalCloseTime:last.closeTime,volumeRatio:round(volumeRatio,2),
  rsi:round(r,1),atr5};
}


// Third research hypothesis: a 1m Bollinger(20,2) break plus volume
// expansion, within the ALREADY-closed 5m+15m EMA20/50 trend.
// Do not include the trigger candle in its Bollinger/volume baseline,
// infer future HTF values, send alerts or influence live entry eligibility.
export function evaluateOneMinuteBollingerVolume(one,five,fifteen){
 if(![one,five,fifteen].every(Array.isArray)||
  one.length<60||five.length<60||fifteen.length<60||
  !continuous(one.slice(-60))||!continuous(five.slice(-60))||
  !continuous(fifteen.slice(-60)))return {stage:'INSUFFICIENT_CLOSED_DATA'};
 if(five.at(-1).closeTime>one.at(-1).closeTime||
   fifteen.at(-1).closeTime>one.at(-1).closeTime)return {stage:'FUTURE_CONTEXT'};
 const trend5=contextTrend(five,5),trend15=contextTrend(fifteen,15);
 if(!trend5||trend5!==trend15)return {stage:'TREND_MISMATCH'};
 const direction=trend5,prev=one.at(-2),last=one.at(-1);
 const period=ONE_MINUTE_RESEARCH.bollingerPeriod;
 const band=values=>{
  const mean=values.reduce((sum,n)=>sum+n,0)/values.length;
  const std=Math.sqrt(values.reduce((sum,n)=>sum+(n-mean)**2,0)/values.length);
  return {upper:mean+ONE_MINUTE_RESEARCH.bollingerDeviations*std,
   lower:mean-ONE_MINUTE_RESEARCH.bollingerDeviations*std,std};
 };
 const previousBand=band(one.slice(-period-2,-2).map(c=>c.close));
 const currentBand=band(one.slice(-period-1,-1).map(c=>c.close));
 if(!good(currentBand.std)||!good(previousBand.std))
  return {stage:'FLAT_BANDS',direction};
 const crossed=direction==='LONG'?
  prev.close<=previousBand.upper&&last.close>currentBand.upper:
  prev.close>=previousBand.lower&&last.close<currentBand.lower;
 if(!crossed)return {stage:'NO_BAND_BREAK',direction};
 const volumeAverage=one.slice(-21,-1).reduce((sum,c)=>sum+c.volume,0)/20;
 const volumeRatio=volumeAverage>0?last.volume/volumeAverage:0;
 if(volumeRatio<ONE_MINUTE_RESEARCH.volumeMin)
  return {stage:'LOW_VOLUME',direction};
 const rsi=radar.rsi(one.map(c=>c.close));
 if(direction==='LONG'?
   rsi<ONE_MINUTE_RESEARCH.rsiLong[0]||rsi>ONE_MINUTE_RESEARCH.rsiLong[1]:
   rsi<ONE_MINUTE_RESEARCH.rsiShort[0]||rsi>ONE_MINUTE_RESEARCH.rsiShort[1])
  return {stage:'RSI',direction};
 const atr1=radar.atr(one),atr5=radar.atr(five),range=last.high-last.low;
 if(!good(atr1)||!good(atr5)||!good(range))
  return {stage:'CANDLE',direction};
 const wick=direction==='LONG'?(last.high-last.close)/range:
  (last.close-last.low)/range;
 if(wick>ONE_MINUTE_RESEARCH.maxOpposingWick||
  Math.abs(last.close-last.open)/range<ONE_MINUTE_RESEARCH.minBodyFraction)
  return {stage:'CANDLE',direction};
 const extension=direction==='LONG'?
  last.close-currentBand.upper:currentBand.lower-last.close;
 if(extension>ONE_MINUTE_RESEARCH.maxBandExtensionAtr*atr1||
  range>2.6*atr1)return {stage:'EXTENDED',direction};
 return {stage:'FOUND',direction,signalClose:last.close,
  signalCloseTime:last.closeTime,volumeRatio:round(volumeRatio,2),
  rsi:round(rsi,1),atr5,
  bandExtensionAtr:round(extension/atr1,2)};
}

function outcome1m(direction,entry,stop,take,bars,{feeBps,slippageBps}){
 // One-minute OHLC replay: do not score partial candles or guess TP/SL ordering.
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
 let checked=0,barGaps=0,unavailableHTF=0;
 const newStudy=()=>({stages:{},triggered:0,skipQuote:0,skipLevels:0,levelRejections:{},skipCosts:0,skipRisk:0,skipOther:0,rows:[]});
 const studies={breakout:newStudy(),pullback:newStudy(),bollingerVolume:newStudy()};
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
  const candidates=[
   ['breakout',evaluateOneMinuteDiscovery(oneWindow,f,t)],
   ['pullback',evaluateOneMinutePullback(oneWindow,f,t)],
   ['bollingerVolume',evaluateOneMinuteBollingerVolume(oneWindow,f,t)]
  ];
  for(const [strategy,found] of candidates){
  const stat=studies[strategy];
  stat.stages[found.stage]=(stat.stages[found.stage]||0)+1;
  if(found.stage!=='FOUND')continue;
  stat.triggered++;
  const {direction,atr5}=found;
  const price=next.open;
  // Compare with contemporaneous next 1m OPEN, not the current 1m close.
  // This approximates quote at the next signal-dispatch opportunity.
  if(!radar.currentPriceQuality(direction,bar.close,radar.atr(oneWindow),price).ok){
   stat.skipQuote++;continue;
  }
  const stop=direction==='LONG'?bar.close-1.2*atr5:bar.close+1.2*atr5;
  const take=direction==='LONG'?bar.close+3*atr5:bar.close-3*atr5;
  const nearest=closestOpposingPivot(f,direction,price,take);
  const level=checkEntryLevels({direction,entry:price,stop,take,nearestLevel:nearest});
  if(!level.ok){
   stat.skipLevels++;
   const reason=classifyEntryRejection(level);
   stat.levelRejections[reason]=(stat.levelRejections[reason]||0)+1;
   continue;
  }
  const cost=assessNetCosts({exchange:'WEEX',direction,entryMid:price,
   bid:price,ask:price,stop,take,feeBpsEachSide:feeBps,
   slippageBpsEachSide:slippageBps});
  if(!cost||cost.netTargetBps<=0||cost.netRR<ONE_MINUTE_RESEARCH.minNetRR){
   stat.skipCosts++;continue;
  }
  const grossRisk=500*Math.abs(price-stop)/price;
  const netRisk=500*cost.netStopLossBps/10000;
  if(grossRisk>10||netRisk>10||grossRisk<=0||netRisk<=0){
   stat.skipRisk++;continue;
  }
  // Full 60 future 1m bars checked for continuity above. Include next
  // 1m entry bar, but never use the trigger bar's high/low for scoring.
  const result=outcome1m(direction,price,stop,take,
   one.slice(i+1,i+1+HOLD_MINUTES),{feeBps,slippageBps});
  if(result.status==='NO_DATA'){stat.skipOther++;continue}
  stat.rows.push({direction,status:result.status,netR:result.netR,grossR:result.grossR});
  }
 }
 const breakout=studies.breakout,pullback=studies.pullback,
  bollingerVolume=studies.bollingerVolume;
 function report(stat){
  return {
   filter:{stages:stat.stages,triggered:stat.triggered,
    skipQuote:stat.skipQuote,skipLevels:stat.skipLevels,
    levelRejections:stat.levelRejections,
    skipCosts:stat.skipCosts,skipRisk:stat.skipRisk,
    skipOther:stat.skipOther},
   results:summarize(stat.rows)
  };
 }
 return {
  mode:'RESEARCH_ONLY_ONE_MINUTE',ordersSent:0,liveActivation:false,
  rules:ONE_MINUTE_RESEARCH,
  source:'WEEX closed 1m, 5m, 15m futures candles, only completed HTF bars as of signal',
  coverage:{one:one.length,five:five.length,fifteen:fifteen.length,
   checked,barGaps,unavailableHTF},
  filter:report(breakout).filter,
  results:report(breakout).results,
  strategies:{breakout:report(breakout),pullback:report(pullback),
   bollingerVolume:report(bollingerVolume)},
  limitations:[
   'Post-close next-minute OPEN is an execution proxy, not a guaranteed quote/fill.',
   'Bid/ask spread modeled as ZERO (optimistic); funding, orderbook, latency and capacity omitted.',
   'Correlated signals can overlap; no portfolio, liquidation or account P&L simulation.',
   'Prior historical candles cannot prove future profitability; check unseen periods before live use.'
  ]
 };
}
