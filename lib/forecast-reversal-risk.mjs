// Read-only 5m trading-context reversal guard for forecast candidates.
// It is NOT a probability model or entry approval. Closed 1m/5m candles only.
// No new exchange requests, API keys, orders, or future-candle information.
import {marketForecastProfile} from './market-forecast-profiles.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const MIN=60000,FIVE=300000;
export const REVERSAL_PROTOCOL=Object.freeze({
 version:'2026-11-12-5m-closed-reversal-guard-v1',
 minMinutes:26,minFiveMinuteBars:16,extraWEEXQueries:0,noOrders:true
});
export function assessForecastReversalRisk(d,one,five,symbol=d?.symbol){
 const unknown={mode:'CLOSED_1M_5M_REVERSAL',sampleReady:false,
  risk:'UNKNOWN',highRisk:false,reasons:[],symbol,
  group:marketForecastProfile(symbol)?.group||null,tradeSignal:false};
 const direction=d?.combinedDirection==='LONG_BIAS'?1:
  d?.combinedDirection==='SHORT_BIAS'?-1:0;
 const m1=d?.timeframes?.[0],m5=d?.timeframes?.[1];
 if(!direction||!Array.isArray(one)||one.length<REVERSAL_PROTOCOL.minMinutes||
  !Array.isArray(five)||five.length<REVERSAL_PROTOCOL.minFiveMinuteBars||
  !finite(m1?.atr14)||m1.atr14<=0||!finite(m5?.atr14)||m5.atr14<=0||
  !Number.isSafeInteger(m1.closedAt)||!Number.isSafeInteger(m5.closedAt))
  return unknown;
 const a=one.slice(-26),b=five.slice(-16);
 const complete=(rows,step,lastAt)=>rows.every((r,i)=>
  Number.isSafeInteger(r?.closeTime)&&r.closeTime<=lastAt&&
  finite(r.close)&&r.close>0&&finite(r.open)&&r.open>0&&
  (i===0||r.closeTime===rows[i-1].closeTime+step));
 if(!complete(a,MIN,m1.closedAt)||!complete(b,FIVE,m5.closedAt)||
  a.at(-1).closeTime!==m1.closedAt||b.at(-1).closeTime!==m5.closedAt||
  Math.abs(a.at(-1).close-m1.price)>Math.max(m1.price*0.000001,0.0000000051))
  return unknown;
 const last=a.at(-1).close;
 const against=x=>direction*x<0;
 const twoAgainst=against(a[25].close-a[24].close)&&
  against(a[24].close-a[23].close);
 const counter3Atr=direction*(a[25].close-a[22].close)/m1.atr14;
 const run15Atr=direction*(a[22].close-a[7].close)/m1.atr14;
 // 5m candle direction matters for the user's manual 5-minute chart.
 const fiveBodyAtr=direction*(b.at(-1).close-b.at(-1).open)/m5.atr14;
 const fiveAgainst=fiveBodyAtr<=-0.35;
 // Require both a sustained earlier impulse AND an actual reversal to
 // suppress; a single red/green candle cannot flip the forecast.
 const turningAfterRun=twoAgainst&&counter3Atr<=-0.65&&run15Atr>=1.1;
 const strongCounterMove=twoAgainst&&counter3Atr<=-0.9&&fiveAgainst;
 const highRisk=turningAfterRun||strongCounterMove;
 const reasons=[];
 if(turningAfterRun)reasons.push('REVERSAL_AFTER_EXTENDED_MOVE');
 if(strongCounterMove)reasons.push('COUNTER_1M_AND_5M');
 if(fiveAgainst&&!highRisk)reasons.push('OPPOSITE_5M_CANDLE');
 const risk=highRisk?'HIGH':fiveAgainst?'ELEVATED':'CLEAR';
 return {...unknown,sampleReady:true,risk,highRisk,reasons,
  prior15mAtr:Number(run15Atr.toFixed(2)),
  counter3mAtr:Number(counter3Atr.toFixed(2)),
  fiveMinuteBodyAtr:Number(fiveBodyAtr.toFixed(2)),
  fiveMinuteClosedAt:m5.closedAt};
}
