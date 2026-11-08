// Closed-candle 5m breakout -> retest -> hold/failure observation.
// RESEARCH ONLY. Do not equate a successful level retest with a trade entry.
// The signal scanner supplies completed candles from ONE exchange; this module
// does not fetch prices, access orders, subscribe to push or change filters.
export const RETEST_LOOKBACK=12;
export const RETEST_WINDOW=6;
export const MIN_BREAKOUT_ATR=0.12;
export const MIN_BREAKOUT_VOLUME=1.10;
export const TOUCH_TOLERANCE_ATR=0.18;
export const HOLD_TOLERANCE_ATR=0.08;
export const FAILURE_TOLERANCE_ATR=0.12;
export const MAX_OPPOSING_WICK_ATR=0.35;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,places=8)=>Number(x.toFixed(places));
const dirs=['LONG','SHORT'];

function validCandles(candles){
 return Array.isArray(candles)&&candles.length>=40&&
  candles.every((c,i)=>c&&
    [c.open,c.high,c.low,c.close,c.volume,c.closeTime].every(finite)&&
    c.close>0&&c.open>0&&c.high>=Math.max(c.open,c.close)&&
    c.low<=Math.min(c.open,c.close)&&c.low>0&&c.volume>=0&&
    (i===0||c.closeTime>candles[i-1].closeTime));
}
function toSide(direction,x){return direction==='LONG'?x:-x;}
function evaluateBreak(candles,atr,direction,index){
 const start=index-RETEST_LOOKBACK;
 if(start<0)return null;
 const prior=candles.slice(start,index),bar=candles[index];
 const level=direction==='LONG'?
  Math.max(...prior.map(c=>c.high)):Math.min(...prior.map(c=>c.low));
 const progress=toSide(direction,bar.close-level);
 const volumeMean=prior.slice(-10).reduce((a,c)=>a+c.volume,0)/10;
 const volumeRatio=volumeMean>0?bar.volume/volumeMean:0;
 // No candidate without a closed-candle breakout AND supporting volume.
 if(progress<MIN_BREAKOUT_ATR*atr||volumeRatio<MIN_BREAKOUT_VOLUME)return null;
 return {direction,level,breakoutIndex:index,volumeRatio};
}

function runBreak(candles,atr,setup){
 const {direction,level,breakoutIndex,volumeRatio}=setup,n=candles.length;
 let touchedIndex=null,confirmedIndex=null,failedIndex=null;
 for(let i=breakoutIndex+1;i<n;i++){
  const candle=candles[i];
  const closeOnSide=toSide(direction,candle.close-level);
  const extremeOpposite=direction==='LONG'?level-candle.low:candle.high-level;
  // A close beyond the level in the wrong direction, or a deep opposite
  // wick, is not proof the prior breakout level held.
  if(closeOnSide< -FAILURE_TOLERANCE_ATR*atr||
    extremeOpposite>MAX_OPPOSING_WICK_ATR*atr){
   failedIndex=i;break;
  }
  const approached=direction==='LONG'?
    candle.low<=level+TOUCH_TOLERANCE_ATR*atr&&candle.high>=level:
    candle.high>=level-TOUCH_TOLERANCE_ATR*atr&&candle.low<=level;
  if(approached&&touchedIndex===null)touchedIndex=i;
  if(touchedIndex!==null&&confirmedIndex===null&&
     closeOnSide>=HOLD_TOLERANCE_ATR*atr){
   confirmedIndex=i;
  }
 }
 const latest=n-1;
 const status=failedIndex!==null?'FAILED':
  confirmedIndex===latest?'CONFIRMED':
  confirmedIndex!==null?'RECENT_CONFIRMED':
  touchedIndex!==null?'TESTING':'WAITING';
 const eventIndex=failedIndex??confirmedIndex??touchedIndex??breakoutIndex;
 const levelRounded=round(level);
 return {
  mode:'OBSERVE_5M',status,direction,level:levelRounded,
  breakoutAt:candles[breakoutIndex].closeTime,
  retestAt:touchedIndex===null?null:candles[touchedIndex].closeTime,
  confirmedAt:confirmedIndex===null?null:candles[confirmedIndex].closeTime,
  failedAt:failedIndex===null?null:candles[failedIndex].closeTime,
  candleCloseTime:candles[latest].closeTime,
  breakoutVolumeRatio:round(volumeRatio,2),
  ageBars:latest-breakoutIndex,
  eventBarsAgo:latest-eventIndex,
  fresh:((confirmedIndex===latest)||(failedIndex===latest)),
  note:'Ретест оценивается только по закрытым 5м свечам; это не торговый сигнал.'
 };
}

export function evaluateRetest(candles,atr,direction){
 if(!dirs.includes(direction)||!finite(atr)||atr<=0||
   !validCandles(candles))return null;
 const n=candles.length,recent=[];
 for(let i=Math.max(RETEST_LOOKBACK,n-RETEST_WINDOW);i<n;i++){
  const setup=evaluateBreak(candles,atr,direction,i);
  if(setup)recent.push(runBreak(candles,atr,setup));
 }
 if(!recent.length)return null;
 // A newly confirmed retest is more useful than a newer tentative breakout.
 const priorities={CONFIRMED:6,FAILED:5,TESTING:4,
  WAITING:3,RECENT_CONFIRMED:2};
 recent.sort((a,b)=>(
  (priorities[b.status]||0)-(priorities[a.status]||0)||
  b.breakoutAt-a.breakoutAt
 ));
 return recent[0];
}

export function evaluateRetestBoth(candles,atr,trend15=null){
 const long=evaluateRetest(candles,atr,'LONG');
 const short=evaluateRetest(candles,atr,'SHORT');
 for(const r of [long,short])if(r){
  r.trendAligned=trend15===null?null:
   r.direction===trend15;
 }
 return {LONG:long,SHORT:short};
}
