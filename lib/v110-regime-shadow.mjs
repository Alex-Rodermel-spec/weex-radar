// V110 closed-candle regime observation. Never alters live signal gates.
// Uses only bars completed by decisionAt; no future bars or live quote needed.
const MIN5=300000,MIN15=900000;
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const round=(n,d=2)=>Number(n.toFixed(d));
const ALLOWED=Object.freeze(['TREND_UP','TREND_DOWN','RANGE','VOLATILE','MIXED','UNKNOWN']);
export const V110_REGIME_POLICY=Object.freeze({
 version:'v110-regime-shadow-v1',validRegimes:ALLOWED,
 min5mBars:60,min15mBars:60,emaPeriods:[20,50],
 trendGap5mBps:8,trendGap15mBps:8,
 rangeGap5mBps:8,rangeGap15mBps:8,
 volatilityRangeMultiple:2.5,lookbackRange:20,
 modelOnly:true,changesLiveSignals:false,ordersSent:0
});
function validWindow(rows,duration,decisionAt){
 if(!Array.isArray(rows)||rows.length<60||rows.length>1000||
   !Number.isSafeInteger(decisionAt))return false;
 const last=rows.slice(-60);
 return last.every((bar,i)=>bar&&Number.isSafeInteger(bar.time)&&
  bar.time%duration===0&&bar.closeTime===bar.time+duration&&
  bar.closeTime<=decisionAt&&valid(bar.close)&&bar.close>0&&
  valid(bar.open)&&bar.open>0&&valid(bar.high)&&valid(bar.low)&&
  bar.low>0&&bar.high>=Math.max(bar.open,bar.close,bar.low)&&
  bar.low<=Math.min(bar.open,bar.close)&&
  (i===0||bar.time===last[i-1].closeTime));
}
function ema(series,period){
 let e=series.slice(0,period).reduce((a,b)=>a+b,0)/period;
 for(const px of series.slice(period))
  e=e+(px-e)*2/(period+1);
 return e;
}
export function classifyV110MarketRegime(five,fifteen,decisionAt){
 const fail={regime:'UNKNOWN',available:false,observedAt:null,
  gap5mBps:null,gap15mBps:null,rangeMultiple:null,
  changesLiveSignals:false,ordersSent:0};
 if(!validWindow(five,MIN5,decisionAt)||
   !validWindow(fifteen,MIN15,decisionAt))return fail;
 const f=five.slice(-60),t=fifteen.slice(-60);
 const close=f.at(-1).close;
 const gap5=10000*(ema(f.map(x=>x.close),20)-ema(f.map(x=>x.close),50))/close;
 const gap15=10000*(ema(t.map(x=>x.close),20)-ema(t.map(x=>x.close),50))/t.at(-1).close;
 const lastRange=(f.at(-1).high-f.at(-1).low)/close;
 const avgEarlierRange=f.slice(-21,-1).reduce((a,b)=>a+(b.high-b.low)/b.close,0)/20;
 const multiple=avgEarlierRange>0?lastRange/avgEarlierRange:null;
 let regime='MIXED';
 if(multiple!==null&&multiple>=V110_REGIME_POLICY.volatilityRangeMultiple)
  regime='VOLATILE';
 else if(gap5>=V110_REGIME_POLICY.trendGap5mBps&&
   gap15>=V110_REGIME_POLICY.trendGap15mBps)regime='TREND_UP';
 else if(gap5<=-V110_REGIME_POLICY.trendGap5mBps&&
   gap15<=-V110_REGIME_POLICY.trendGap15mBps)regime='TREND_DOWN';
 else if(Math.abs(gap5)<V110_REGIME_POLICY.rangeGap5mBps&&
   Math.abs(gap15)<V110_REGIME_POLICY.rangeGap15mBps)regime='RANGE';
 return {regime,available:true,observedAt:f.at(-1).closeTime,
  gap5mBps:round(gap5),gap15mBps:round(gap15),
  rangeMultiple:multiple===null?null:round(multiple),
  changesLiveSignals:false,ordersSent:0};
}
