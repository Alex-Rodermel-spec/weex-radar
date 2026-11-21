// Independent experimental FORECAST V5 5-minute direction proposal.
// Uses *only* already-closed, continuous 1m/5m WEEX candles before publication.
// Intentionally does NOT inherit the legacy (correlated) 10m consensus.
// This algorithm is a research candidate, not a probability, signal, order,
// automatic ntfy gate or production trading strategy.
const MIN=60_000,FIVE=5*MIN;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const avg=rows=>rows.reduce((s,v)=>s+v,0)/rows.length;
const round=(x,p=3)=>Number(x.toFixed(p));
const SIDE={LONG_BIAS:1,SHORT_BIAS:-1};
export const FORECAST_V5_POLICY=Object.freeze({
 version:'forecast-v5-independent-5m-direction-v1',primaryHorizonMinutes:5,
 sampleMin1m:65,sampleMin5m:65,needsClosed5m:true,
 independentFromTenMinuteVote:true,
 liveNotificationsChanged:false,tradeAlertsChanged:false,
 marketRequestsAdded:0,ordersSent:0,
 validatedAccuracyGain:false,automaticPromotion:false
});
function good(rows,min,step,at){
 if(!Array.isArray(rows)||rows.length<min)return false;
 const recent=rows.slice(-min),last=recent.at(-1);
 if(!Number.isSafeInteger(last?.closeTime)||last.closeTime>at-1000||
   last.closeTime%step!==0)return false;
 for(let i=0;i<recent.length;i++){
  const b=recent[i];
  if(!Number.isSafeInteger(b?.closeTime)||!finite(b.close)||b.close<=0||
    !finite(b.open)||b.open<=0||!finite(b.high)||!finite(b.low)||
    !finite(b.volume)||b.volume<0||b.high<Math.max(b.close,b.open)||
    b.low>Math.min(b.close,b.open)||
    i&&b.closeTime!==recent[i-1].closeTime+step)return false;
 }
 return true;
}
function ema(values,span){
 if(values.length<span)return null;
 let value=avg(values.slice(0,span));
 const alpha=2/(span+1);
 for(let i=span;i<values.length;i++)value=value+(values[i]-value)*alpha;
 return value;
}
function rsi(values,period=14){
 if(values.length<period+1)return null;
 let gains=0,losses=0;
 for(let i=1;i<=period;i++){
  let diff=values[i]-values[i-1];
  gains+=Math.max(0,diff);losses+=Math.max(0,-diff);
 }
 gains/=period;losses/=period;
 for(let i=period+1;i<values.length;i++){
  const diff=values[i]-values[i-1];
  gains=(gains*(period-1)+Math.max(0,diff))/period;
  losses=(losses*(period-1)+Math.max(0,-diff))/period;
 }
 return gains+losses===0?50:losses===0?100:100-100/(1+gains/losses);
}
function atr(rows){
 const r=rows.slice(-15);
 if(r.length<15)return null;
 const tr=[];
 for(let i=1;i<r.length;i++)tr.push(Math.max(r[i].high-r[i].low,
  Math.abs(r[i].high-r[i-1].close),Math.abs(r[i].low-r[i-1].close)));
 return avg(tr);
}
const empty={
 mode:'V5_5M_DIRECTION_RESEARCH',available:false,direction:'MIXED',
 status:'NO_COMPLETE_EVIDENCE',confidenceIsCalibrated:false,
 signalPermission:false,noTrade:true,ordersSent:0,
 liveNotificationsChanged:false,accuracyImprovedNotYetProven:true
};
export function evaluateForecastV5(one,five,now=Date.now()){
 if(!Number.isSafeInteger(now)||now<=0||
  !good(one,FORECAST_V5_POLICY.sampleMin1m,MIN,now)||
  !good(five,FORECAST_V5_POLICY.sampleMin5m,FIVE,now))
  return {...empty,reason:'MISSING_VALID_CLOSED_BARS'};
 const end1=one.at(-1).closeTime,end5=five.at(-1).closeTime;
 if(now-end1>92_000||now-end5>6*MIN+1000||
  end5>end1||end1-end5>=FIVE)
  return {...empty,reason:'INCONSISTENT_OR_STALE_CONTEXT'};
 const c1=one.map(b=>b.close),c5=five.map(b=>b.close);
 const m1=ema(c1,20),m5=ema(c5,20),fifty5=ema(c5,50);
 const m5prev=ema(c5.slice(0,-3),20),r1=rsi(c1),r5=rsi(c5);
 const a1=atr(one),a5=atr(five);
 if(![m1,m5,fifty5,m5prev,r1,r5,a1,a5].every(finite)||a1<=0||a5<=0)
  return {...empty,reason:'NO_VALID_INDICATORS'};
 const v1=avg(one.slice(-21,-1).map(b=>b.volume)),
  v5=avg(five.slice(-21,-1).map(b=>b.volume));
 if(v1<=0||v5<=0)return {...empty,reason:'NO_VOLUME_BASELINE'};
 const vol1=one.at(-1).volume/v1,vol5=five.at(-1).volume/v5;
 const last5=five.at(-1),last1=one.at(-1);
 // Independent *continuous* 5m momentum and 1m recent price impulse.
 // A 10m candle is constructed from 5m and must NOT double-count.
 const move1m3=last1.close-one.at(-4).close;
 const body5=last5.close-last5.open;
 const change5m=last5.close-five.at(-4).close;
 const trendEfficiency=(()=>{
  const six=five.slice(-7),path=six.slice(1).reduce(
   (sum,b,i)=>sum+Math.abs(b.close-six[i].close),0);
  return path>0?Math.abs(six.at(-1).close-six[0].close)/path:0;
 })();
 const sufficientParticipation=vol1>=0.72&&vol5>=0.7&&vol1<=6&&vol5<=6;
 const trendGap=(m5-fifty5)/a5,emaSlope=(m5-m5prev)/a5;
 const safeExtension=Math.abs(move1m3)<=1.2*a5&&
  Math.abs(last1.close-m5)<=2*a5;
 const stableContext=trendEfficiency>=0.20&&
  Math.abs(change5m)>=0.30*a5;
 const common=sufficientParticipation&&safeExtension&&stableContext;
 const long=common&&trendGap>0.08&&emaSlope>0.05&&
  r5>=51&&r5<=72&&r1>=49&&r1<=72&&
  last1.close>=m1&&last1.close>=m5&&
  move1m3>0.04*a1&&body5>-0.30*a5&&
  change5m>0;
 const short=common&&trendGap< -0.08&&emaSlope< -0.05&&
  r5>=28&&r5<=49&&r1>=28&&r1<=51&&
  last1.close<=m1&&last1.close<=m5&&
  move1m3< -0.04*a1&&body5<0.30*a5&&
  change5m<0;
 const direction=long?'LONG_BIAS':short?'SHORT_BIAS':'MIXED';
 return {...empty,available:true,status:direction==='MIXED'?
  'NO_5M_EDGE_ESTABLISHED':'V5_CONDITIONAL_5M_CANDIDATE',
  direction,closedAt1m:end1,closedAt5m:end5,
  horizonMinutes:5,validatedOutOfSample:false,
  evidence:{trendGapAtr:round(trendGap),ema20Slope3Atr:round(emaSlope),
   rsi1m:round(r1,1),rsi5m:round(r5,1),
   volumeRatio1m:round(vol1,2),volumeRatio5m:round(vol5,2),
   trendEfficiency5m:round(trendEfficiency,3),
   body5mAtr:round(body5/a5),move1m3Atr:round(move1m3/a1),
   priceVsEma20_5mAtr:round((last1.close-m5)/a5),
   no10mDoubleCount:true},
  explanation:direction==='MIXED'?
   'Не подтверждён независимый 5-минутный импульс: воздержаться от направленного прогноза.':
   'Эксперимент: 5М тренд и RSI, 1М импульс, объём и отсутствие явного истощения. Преимущество ещё не доказано.'
 };
}
