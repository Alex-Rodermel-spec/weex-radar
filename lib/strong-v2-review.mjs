// Shadow-only upgrade of forecast strength. Uses completed 1m bars that
// existed at forecast generation. Never changes signal classes or alerts.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=(n,p=2)=>Number(n.toFixed(p));
export function reviewStrongV2(forecast,minuteBars){
 const base={mode:'FORECAST_STRONG_V2_SHADOW',status:'UNAVAILABLE',
  baselineLevel:forecast?.strengthRisk?.level||'UNAVAILABLE',
  proposedLevel:null,reasons:[],sampleReady:false,notATrade:true,
  notificationsUnchanged:true,calibratedProbability:false};
 if(!['STRONG','STANDARD'].includes(base.baselineLevel))
  return {...base,status:'NOT_ELIGIBLE'};
 const m1=forecast?.timeframes?.[0];
 const direction=forecast.combinedDirection==='LONG_BIAS'?1:
  forecast.combinedDirection==='SHORT_BIAS'?-1:0;
 const bars=minuteBars;
 if(!direction||!Array.isArray(bars)||bars.length<17||
  !finite(m1?.price)||!finite(m1?.atr14)||m1.atr14<=0||
  !finite(m1?.ema20)||!finite(m1?.relativeVolume)||
  !Number.isSafeInteger(forecast.generatedAt))
  return {...base,reasons:['MISSING_EVIDENCE']};
 const window=bars.slice(-16),last=window.at(-1),first=window[0];
 if(!window.every((b,i)=>finite(b?.close)&&b.close>0&&
  Number.isSafeInteger(b.closeTime)&&b.closeTime<=forecast.generatedAt&&
  (i===0||b.closeTime===window[i-1].closeTime+60000))||
  last.closeTime!==m1.closedAt||
  Math.abs(last.close-m1.price)>Math.max(m1.atr14*0.02,m1.price*0.0005))
  return {...base,reasons:['STALE_OR_GAPPED_BARS']};
 // Last closed price minus the close 15 minutes earlier, in forecast direction.
 // ATR normalization prevents using a fixed 0.1% rule on every crypto pair.
 const progress=direction*(last.close-first.close);
 const preMove15mBps=round(10000*progress/first.close,1);
 const progressAtr=round(progress/m1.atr14,2);
 const emaExtensionAtr=round(direction*(last.close-m1.ema20)/m1.atr14,2);
 const reasons=[];
 if(preMove15mBps>=10&&progressAtr>=1.5)
  reasons.push('PRE_ALERT_MOVE_EXTENDED');
 if(emaExtensionAtr>1.4)reasons.push('AWAY_FROM_EMA20');
 if(m1.relativeVolume>3.5)reasons.push('VOLUME_SPIKE');
 const proposedLevel=reasons.length?
  (base.baselineLevel==='STRONG'?'STANDARD':'CAUTION'):
  base.baselineLevel;
 return {...base,status:reasons.length?'REVIEW_DOWNGRADE':
   base.baselineLevel==='STRONG'?'REVIEW_KEEP_STRONG':'REVIEW_KEEP_STANDARD',
  proposedLevel,sampleReady:true,reasons,
  observations:{preMove15mBps,preMove15mAtr:progressAtr,
   emaExtensionAtr,volumeRatio1m:m1.relativeVolume,
   evaluatedAt:last.closeTime},
  note:'Теневая гипотеза: это не подтвержденная точность и не цена входа.'};
}
export const STRONG_V2_REASONS=Object.freeze({
 PRE_ALERT_MOVE_EXTENDED:'Цена уже заметно прошла в сторону прогноза за 15 минут',
 AWAY_FROM_EMA20:'Цена растянулась от EMA20 в сторону движения',
 VOLUME_SPIKE:'Необычно резкий всплеск минутного объёма',
 MISSING_EVIDENCE:'Недостаточно закрытых свечей или индикаторов',
 STALE_OR_GAPPED_BARS:'Свечи устарели, имеют пропуски или не совпадают с прогнозом'
});
