// Descriptive (uncalibrated) forecast strength and reversal/late-chase risk.
// This is an OBSERVATION only; it never changes trading permissions, creates
// orders, or treats oscillator extremes as guaranteed reversal probabilities.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const BIAS=['LONG_BIAS','SHORT_BIAS'];
const STRONG='STRONG',STANDARD='STANDARD',CAUTION='CAUTION',UNAVAILABLE='UNAVAILABLE';
export function assessForecastStrengthRisk(d){
 const base={mode:'FORECAST_STRENGTH_RISK_V1',
  level:UNAVAILABLE,risk:'UNKNOWN',direction:'MIXED',
  reasons:[],tradeSignal:false,calibratedProbability:false,
  note:'Оценка силы и риска эвристическая; это не вероятность прибыли и не сигнал входа.'};
 if(!d?.available||!BIAS.includes(d.combinedDirection)||
  d.alignment!=='THREE_TIMEFRAME_ALIGNMENT'||
  !Array.isArray(d.timeframes)||d.timeframes.length!==3||
  d.timeframes.map(f=>f.intervalMinutes).join(',')!=='1,5,10')
  return {...base,reasons:['MIXED_OR_INCOMPLETE']};
 const [m1,m5,m10]=d.timeframes;
 if([m1,m5,m10].some(f=>f.direction!==d.combinedDirection||
  !finite(f.rsi14)||!finite(f.voteAgreement)||!finite(f.price)||f.price<=0)||
  !finite(m1.relativeVolume)||!finite(m1.atr14)||m1.atr14<=0)
  return {...base,reasons:['INDICATOR_DATA_UNAVAILABLE']};
 const short=d.combinedDirection==='SHORT_BIAS';
 const reasons=[];
 // Multi-timeframe extremes are the key lesson from the LINK/AVAX case:
 // five- and ten-minute RSI below 30 can precede a squeeze on a SHORT.
 for(const [f,name] of [[m1,'1M'],[m5,'5M'],[m10,'10M']]){
  if(short&&f.rsi14<=30)reasons.push('OVERSOLD_'+name);
  if(!short&&f.rsi14>=70)reasons.push('OVERBOUGHT_'+name);
 }
 const bb=m1.bollinger20;
 if(short&&bb?.position==='BELOW_LOWER')reasons.push('BELOW_LOWER_BOLLINGER');
 if(!short&&bb?.position==='ABOVE_UPPER')reasons.push('ABOVE_UPPER_BOLLINGER');
 if(m1.relativeVolume<0.9)reasons.push('WEAK_1M_VOLUME');
 if(m1.atr14/m1.price>=0.035)reasons.push('HIGH_1M_VOLATILITY');
 const ctx=d.primaryContext||{};
 const structureAligned=short?ctx.structure==='LOWER_HIGHS_LOW':
  ctx.structure==='HIGHER_HIGHS_LOW';
 if(ctx.structure&&ctx.structure!=='RANGE_OR_MIXED'&&!structureAligned)
  reasons.push('STRUCTURE_OPPOSING');
 const obstacle=short?ctx.observedSupport:ctx.observedResistance;
 if(finite(obstacle)&&obstacle>0){
  const distance=short?m1.price-obstacle:obstacle-m1.price;
  if(distance>=0&&distance<=m1.atr14*0.6)reasons.push(
   short?'SUPPORT_NEAR_PRICE':'RESISTANCE_NEAR_PRICE');
 }
 const risk=reasons.length?'ELEVATED':'NORMAL';
 // Strong = all three timeframes have 3/3 momentum/EMA/BB votes,
 // enough observed 1m volume, non-opposing structure, and no hazard.
 // This is *not* a statistical accuracy guarantee.
 const highAgreement=[m1,m5,m10].every(f=>f.voteAgreement===3);
 const strong=risk==='NORMAL'&&highAgreement&&m1.relativeVolume>=1.15&&
  structureAligned;
 return {...base,direction:d.combinedDirection,risk,reasons,
  level:risk==='ELEVATED'?CAUTION:strong?STRONG:STANDARD,
  observations:{timeframesAgree:true,strongVoteAgreement:highAgreement,
   structureAligned,oneMinuteVolumeRatio:m1.relativeVolume}};
}
export const FORECAST_RISK_LABELS=Object.freeze({
 STRONG:'🟣 СИЛЬНЫЙ ПРОГНОЗ',
 STANDARD:'🔵 ОБЫЧНЫЙ ПРОГНОЗ',
 CAUTION:'🟡 ПОВЫШЕННЫЙ РИСК',
 UNAVAILABLE:'⚪ НЕОПРЕДЕЛЁННО'
});
export const FORECAST_RISK_REASONS=Object.freeze({
 OVERSOLD_1M:'RSI 1М перепродан; возможен отскок',
 OVERSOLD_5M:'RSI 5М перепродан; риск отскока',
 OVERSOLD_10M:'RSI 10М перепродан; риск отскока',
 OVERBOUGHT_1M:'RSI 1М перекуплен; возможен откат',
 OVERBOUGHT_5M:'RSI 5М перекуплен; риск отката',
 OVERBOUGHT_10M:'RSI 10М перекуплен; риск отката',
 BELOW_LOWER_BOLLINGER:'Цена за нижней полосой Bollinger; риск догонять падение',
 ABOVE_UPPER_BOLLINGER:'Цена за верхней полосой Bollinger; риск догонять рост',
 WEAK_1M_VOLUME:'Низкий объём на 1М',
 HIGH_1M_VOLATILITY:'Повышенная волатильность на 1М',
 SUPPORT_NEAR_PRICE:'Поддержка близко к текущей цене',
 RESISTANCE_NEAR_PRICE:'Сопротивление близко к текущей цене',
 STRUCTURE_OPPOSING:'Структура 5М против прогноза',
 MIXED_OR_INCOMPLETE:'Таймфреймы не согласованы либо данных недостаточно',
 INDICATOR_DATA_UNAVAILABLE:'Недостаточно проверенных индикаторов'
});
