// Read-only 10-minute forecast context aggregated from completed 5m WEEX candles.
// WEEX does not offer a native 10m candle interval. No order or signal gates here.
import {_test as indicators} from '../api/signals.mjs';
import {forecastBollinger} from './forecast-bollinger.mjs';

const FIVE=300000, TEN=600000;
const valid=c=>c&&[c.time,c.closeTime,c.open,c.high,c.low,c.close,c.volume]
 .every(n=>typeof n==='number'&&Number.isFinite(n))&&
 c.time>=0&&c.closeTime===c.time+FIVE&&c.open>0&&c.close>0&&
 c.high>=Math.max(c.open,c.close)&&c.low>0&&
 c.low<=Math.min(c.open,c.close)&&c.volume>=0;

// Combine only two consecutive, fully CLOSED 5m bars aligned to a UTC 10m boundary.
// A missing, partial or misaligned bar is never backfilled or guessed.
export function aggregateTenMinuteCandles(five,now=Date.now()){
 if(!Array.isArray(five))return [];
 const result=[];
 for(let i=0;i+1<five.length;i++){
  const a=five[i],b=five[i+1];
  if(!valid(a)||!valid(b)||a.time%TEN!==0||
     b.time!==a.closeTime||b.closeTime!==a.time+TEN||b.closeTime>now)continue;
  result.push({time:a.time,closeTime:b.closeTime,open:a.open,
   high:Math.max(a.high,b.high),low:Math.min(a.low,b.low),
   close:b.close,volume:a.volume+b.volume});
  i++;
 }
 return result;
}

export function tenMinuteForecastContext(five,now=Date.now()){
 const candles=aggregateTenMinuteCandles(five,now);
 if(candles.length<50||now-candles.at(-1).closeTime>11*60000)return null;
 const closes=candles.map(c=>c.close),{ema,rsi}=indicators;
 const momentum=rsi(closes),fast=ema(closes,20),slow=ema(closes,50);
 const trend=fast>slow?'UP':fast<slow?'DOWN':'NEUTRAL';
 const volumes=candles.slice(-21,-1).map(c=>c.volume);
 const mean=volumes.reduce((sum,n)=>sum+n,0)/volumes.length;
 const ratio=mean>0?candles.at(-1).volume/mean:0;
 const band=forecastBollinger(closes,20,2);
 const rsiDirection=momentum>53?'UP':momentum<47?'DOWN':'NEUTRAL';
 const priceDirection=band&&candles.at(-1).close>band.middle?'UP':
  band&&candles.at(-1).close<band.middle?'DOWN':'NEUTRAL';
 // A descriptive agreement, NOT a trading signal or calibrated probability.
 const agreement=trend!=='NEUTRAL'&&trend===rsiDirection&&
  trend===priceDirection&&ratio>=1.1?'ALIGNED':'MIXED';
 return {intervalMinutes:10,rsi14:Number(momentum.toFixed(1)),
  trend,volumeRatio:Number(ratio.toFixed(2)),bollinger10:band,
  agreement,closedAt:candles.at(-1).closeTime,observationOnly:true};
}
