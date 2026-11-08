// Presentation ONLY. Never used to decide if a market signal is emitted,
// filtered, sent, traded or persisted. Strength and risk are independent.
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function priceText(value){
 const n=Number(value);
 if(!valid(n))return '—';
 // Up to 8 decimal places for low-priced assets; no hidden order rounding.
 const digits=n>=1000?2:n>=10?3:n>=1?4:n>=.01?6:8;
 return n.toLocaleString('ru-RU',{maximumFractionDigits:digits,useGrouping:false});
}
export function alertPresentation(s,{early=false}={}){
 const strong=s.level==='STRONG',direction=s.direction==='SHORT'?'SHORT':'LONG';
 const retest=s.retest?.[direction];
 const cost=s.costReview;
 let status='WAIT',reason='Подтверждение ещё не получено';
 if(!early){
  if(retest?.status==='FAILED'){
   status='SKIP';reason='Ретест: уровень не удержан';
  }else if(cost?.status==='COSTS_EXCEED_TP'){
   status='SKIP';reason='РАСХОДЫ: TP меньше комиссий и спреда (модель)';
  }else if(cost?.status==='LOW_NET_RR'){
   status='SKIP';reason='Чистый R/R ниже 1,5 (модель)';
  }else if(retest?.status==='CONFIRMED'&&retest.trendAligned===true&&
    cost?.status==='PASS_ESTIMATE'){
   status='CHECK';reason='Ретест удержан, расчётные расходы допустимы';
  }else if(retest?.status==='CONFIRMED'&&retest.trendAligned===true&&
    s.exchange!=='WEEX'){
   status='WAIT';reason='Ретест удержан; расходы резервной биржи не проверены';
  }else if(retest?.status==='CONFIRMED'&&retest.trendAligned===true){
   status='WAIT';reason='Ретест удержан; расходы пока не подтверждены';
  }else{
   status='WAIT';reason='Ретест ещё не подтверждён';
  }
 }
 const badge=status==='CHECK'?'🟢 ПРОВЕРИТЬ':status==='SKIP'?'🔴 ПРОПУСТИТЬ':'🟡 ЖДАТЬ';
 const strength=strong?'🟣 СИЛЬНЫЙ':'🔔 ОБЫЧНЫЙ';
 const label=early?'⚡ EARLY WATCH':strength;
 const symbol=String(s.symbol||'').replace(/[^A-Z0-9]/g,'').slice(0,24);
 const title=badge+' · '+symbol+' '+direction+(early?' · ⚡ РАННИЙ':' · '+strength);
 return {status,badge,strength,title,reason,early,direction,symbol};
}
export function formatPhoneAlert(s,{early=false,deadline=null}={}){
 const v=alertPresentation(s,{early});
 const price=priceText(s.livePrice??s.price??s.closePrice);
 const movement=v.direction==='LONG'?'📈 РОСТ':'📉 ПАДЕНИЕ';
 const lines=[movement+' · '+s.exchange,'📍 Вход: '+price+' USDT'];
 if(!early){
  // Preserve raw order levels in explicit SL/TP labels so that rounding
  // cannot silently change an executable order price on the exchange.
  const stop=valid(Number(s.stop))?String(s.stop):'—';
  const take=valid(Number(s.take))?String(s.take):'—';
  lines.push('✅ Прибыль (TP): '+priceText(s.take)+' · 🛑 Стоп (SL): '+priceText(s.stop));
  lines.push('SL '+stop+' · TP '+take);
  const rr=Number(s.entryQuality?.rr);
  if(Number.isFinite(rr)&&rr>0)lines.push('R/R до расходов: '+rr.toFixed(2)+':1');
  if(s.costReview?.mode==='SHADOW_COSTS'&&Number.isFinite(s.costReview.netRR))
   lines.push('Чистый R/R (модель): '+s.costReview.netRR.toFixed(2)+':1');
 }
 lines.push('⚠️ '+v.reason);
 if(deadline)lines.push('⏰ До '+deadline+' · '+(early?'НЕ ВХОДИТЬ':'Проверь актуальную цену'));
 else lines.push(early?'⏳ Ждать подтверждения 5м · НЕ ВХОДИТЬ':'⚠️ Проверь актуальную цену');
 return {title:v.title,message:lines.join('\n'),...v};
}
