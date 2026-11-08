// Conditional PRE-breakout scenario, not a calibrated probability or a trade.
// Reads ONLY closed candles from the same WEEX market (1m/5m/15m).
// No live orders, future candles, exchange keys, AI-claimed certainty or auto-trades.
import {_test as indicators} from '../api/signals.mjs';
import {evaluateStructure} from './market-structure.mjs';
import {evaluateRetestBoth} from './retest-check.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sign=d=>d==='LONG'?1:-1;
const avg=(a)=>a.reduce((s,v)=>s+v,0)/a.length;
const round=(x,n=8)=>Number(x.toFixed(n));
const validRows=rows=>Array.isArray(rows)&&rows.length>=60&&
 rows.every((c,i)=>c&&[c.open,c.high,c.low,c.close,c.volume,c.closeTime].every(finite)&&
 c.open>0&&c.low>0&&c.volume>=0&&c.high>=Math.max(c.open,c.close)&&
 c.low<=Math.min(c.open,c.close)&&(i===0||c.closeTime>rows[i-1].closeTime));

// Cheap 1m+15m candidate test BEFORE requesting extra 5m candles and a quote.
export function preBreakCandidate(one,fifteen,now=Date.now()){
 if(!validRows(one)||!validRows(fifteen))return null;
 const last=one.at(-1);
 if(last.closeTime>now||now-last.closeTime>45000)return null;
 if(fifteen.at(-1).closeTime>now||now-fifteen.at(-1).closeTime>31*60000)return null;
 const {ema,rsi,atr}=indicators;
 const c1=one.map(c=>c.close),c15=fifteen.map(c=>c.close);
 const atr1=atr(one),rsi1=rsi(c1);
 if(!finite(atr1)||atr1<=0||!finite(rsi1))return null;
 const fast1=ema(c1,20),slow1=ema(c1,50);
 const fast15=ema(c15,20),slow15=ema(c15,50);
 const up=fast1>slow1&&fast15>slow15&&last.close>fast1&&
  fifteen.at(-1).close>fast15&&rsi1>=51&&rsi1<=69;
 const down=fast1<slow1&&fast15<slow15&&last.close<fast1&&
  fifteen.at(-1).close<fast15&&rsi1>=31&&rsi1<=49;
 const direction=up?'LONG':down?'SHORT':null;
 if(!direction)return null;
 const d=sign(direction);
 const before=one.slice(-13,-1);
 const barrier=d===1?Math.max(...before.map(c=>c.high)):Math.min(...before.map(c=>c.low));
 const distance=d*(barrier-last.close);
 // The trigger is AHEAD: no signal after the breakout has happened.
 if(distance<0.06*atr1||distance>0.70*atr1)return null;
 const twenty=one.slice(-21,-1),volumeMean=avg(twenty.map(c=>c.volume));
 const ratio=volumeMean>0?last.volume/volumeMean:0;
 if(ratio<0.85||ratio>2.8)return null;
 const range=last.high-last.low,body=d*(last.close-last.open);
 if(range<=0||body<0.05*atr1||range>1.8*atr1)return null;
 // Avoid a large wick against the intended next move.
 const rejection=d===1?(last.high-last.close)/range:(last.close-last.low)/range;
 if(rejection>0.4)return null;
 if(d*(last.close-one.at(-2).close)<=0)return null;
 if(Math.abs(last.close-fast1)>1.6*atr1)return null;
 const move5=d*(last.close-one.at(-6).close);
 if(move5>1.8*atr1)return null; // do not chase a five-candle impulse
 const context=one.slice(-25,-1),width=
  (Math.max(...context.map(c=>c.high))-Math.min(...context.map(c=>c.low)))/atr1;
 const travelled=context.slice(1).reduce((sum,c,i)=>sum+Math.abs(c.close-context[i].close),0);
 const efficiency=travelled>0?
  Math.abs(context.at(-1).close-context[0].close)/travelled:0;
 if(width<2.5&&efficiency<0.18)return null; // narrow, weak sideways market
 return {direction,barrier,atr1,ratio,rsi1,lastClose:last.close,
  candleCloseTime:last.closeTime,trend15:d===1?'UP':'DOWN'};
}

// Full check uses all three completed timeframes and a same-WEEX live quote.
// Price must remain BEFORE the predicted trigger when the alert is sent.
export function forecastPreBreak(one,five,fifteen,livePrice,now=Date.now()){
 const candidate=preBreakCandidate(one,fifteen,now);
 if(!candidate||!validRows(five)||!finite(livePrice)||livePrice<=0)return null;
 if(five.at(-1).closeTime>now||now-five.at(-1).closeTime>11*60000)return null;
 const {ema,rsi,atr}=indicators;
 const d=sign(candidate.direction),closes=five.map(x=>x.close);
 const atr5=atr(five),fast5=ema(closes,20),slow5=ema(closes,50);
 const rsi5=rsi(closes),last5=five.at(-1);
 if(!finite(atr5)||atr5<=0)return null;
 // Same market and coherent closed 1m/5m prices; reject mismatched/stale
 // timeframe feeds rather than fabricating a multi-timeframe consensus.
 if(Math.abs(last5.close-candidate.lastClose)>Math.max(1.6*atr5,0.002*candidate.lastClose))return null;
 if(d===1?
   !(fast5>slow5&&last5.close>fast5&&rsi5>=48&&rsi5<=73):
   !(fast5<slow5&&last5.close<fast5&&rsi5>=27&&rsi5<=52))return null;
 // Discard exhausted downward/upward impulses, not a late SHORT after collapse.
 if(d*(last5.close-five.at(-4).close)>1.2*atr5)return null;
 if(d*(last5.close-five.at(-7).close)>2.0*atr5)return null;
 const structure=evaluateStructure(five,atr5,candidate.direction);
 if(structure?.flat===true||structure?.failedBreakAt!==null)return null;
 const retest=evaluateRetestBoth(five,atr5,candidate.direction)?.[candidate.direction];
 if(retest?.status==='FAILED'&&retest.eventBarsAgo<=2)return null;
 const {barrier,atr1}=candidate,remaining=d*(barrier-livePrice);
 if(remaining<0.04*atr1||remaining>0.75*atr1)return null;
 if(Math.abs(livePrice-candidate.lastClose)>0.48*atr1)return null;
 const trigger=d===1?barrier+0.05*atr1:barrier-0.05*atr1;
 // Observational invalidation level only, never auto-order SL.
 const lastLows=one.slice(-8).map(c=>c.low),lastHighs=one.slice(-8).map(c=>c.high);
 const invalidation=d===1?Math.min(...lastLows)-0.15*atr1:
  Math.max(...lastHighs)+0.15*atr1;
 if(d*(trigger-invalidation)<=0)return null;
 return {
  mode:'PRE_BREAK_SCENARIO',direction:candidate.direction,horizonMinutes:5,
  triggerPrice:round(trigger,10),invalidationPrice:round(invalidation,10),
  levelPrice:round(barrier,10),referencePrice:round(livePrice,10),
  rsi1:round(candidate.rsi1,1),rsi5:round(rsi5,1),volumeRatio:round(candidate.ratio,2),
  trend15:candidate.trend15,marketStructure:structure?.mode==='SHADOW'?'reviewed':'unavailable',
  message:'Вероятный сценарий движения ДО пробоя, не торговый сигнал. '+ 
    'Дождись пробоя уровня и нового подтверждения. Прогноз может не исполниться.',
  scoreIsCalibratedProbability:false
 };
}
