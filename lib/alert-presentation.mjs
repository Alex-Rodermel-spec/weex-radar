// Display and advisory labels only: no order is ever authorized here.
// Strength, retest evidence and fee/risk are independent.
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
 let status='WAIT',reason='ЖДАТЬ подтверждения 5м';
 if(!early){
  if(retest?.status==='FAILED'){
   status='SKIP';reason='Ретест: уровень не удержан';
  }else if(cost?.status==='COSTS_EXCEED_TP'){
   status='SKIP';reason='РАСХОДЫ: TP меньше комиссий и спреда (модель)';
  }else if(cost?.status==='LOW_NET_RR'){
   status='SKIP';reason='Чистый R/R ниже 1,5 (модель)';
  }else if(cost?.status==='PASS_ESTIMATE'&&s.exchange==='WEEX'){
   // A fresh 5m breakout cannot normally have a separately confirmed
   // completed 5m retest yet. Do NOT require both at the same instant.
   // CHECK is only an invitation to the authenticated MANUAL trade
   // preflight, which independently rechecks all live hard safety gates.
   status='CHECK';
   reason=retest?.status==='CONFIRMED'&&retest.trendAligned===true?
    'Ретест удержан; проверь актуальную цену и риск вручную':
    'Свежий пробой: ретест ещё не подтверждён, риск выше; только ручной вход';
  }else{
   status='WAIT';reason='Ретест или расчётные расходы ещё не подтверждены';
  }
 }
 const badge=status==='CHECK'?'🟢 ПРОВЕРИТЬ':status==='SKIP'?'🔴 ПРОПУСТИТЬ':'🟡 ЖДАТЬ';
 const strength=strong?'🟣 СИЛЬНЫЙ':'🔔 ОБЫЧНЫЙ';
 const label=early?'⚡ EARLY WATCH':strength;
 const symbol=String(s.symbol||'').replace(/[^A-Z0-9]/g,'').slice(0,24);
 const title=badge+' · '+symbol+' '+direction+(early?' · ⚡ EARLY WATCH':' · '+strength);
 return {status,badge,strength,title,reason,early,direction,symbol};
}
// Phone notifications have exactly two intents: a probabilistic forecast, or
// a reviewed entry candidate. Scanner/advisor rules remain unchanged.
export function formatPhoneAlert(s,{early=false,deadline=null}={}){
 const name=String(s?.symbol||'').replace(/[^A-Z0-9]/g,'').slice(0,24);
 const direction=s?.direction==='SHORT'?'SHORT':'LONG';
 const down=direction==='SHORT';
 const movement=down?'ПАДЕНИЯ':'РОСТА';
 const icon=down?'📉':'📈';
 const price=priceText(s?.livePrice??s?.price??s?.closePrice);
 if(early){
  const f=s?.watchType==='PRE_BREAK'&&s?.forecast?.mode==='PRE_BREAK_SCENARIO'?s.forecast:null;
  const lines=[
   icon+' Возможное '+(down?'снижение':'повышение')+' цены · WEEX',
   '📍 Текущая цена: '+price+' USDT'
  ];
  if(f){
   lines.push('⏱ 1М: импульс '+(down?'вниз':'вверх')+
    ' · RSI '+f.rsi1+' · объём ×'+f.volumeRatio);
   lines.push('⏱ 5М: сценарий '+(down?'вниз':'вверх')+' · RSI '+f.rsi5);
   lines.push('⏱ 15М: тренд '+(down?'вниз':'вверх'));
   lines.push('📊 Ориентир продолжения: '+priceText(f.triggerPrice));
   lines.push('❌ Сценарий отменяется около: '+priceText(f.invalidationPrice));
   lines.push('Горизонт сценария: '+f.horizonMinutes+' мин.');
  }else{
   lines.push('⏱ 1М: '+(down?'нисходящий':'восходящий')+' импульс');
   lines.push('⏱ 5М: отдельная проверка не выполнена');
   lines.push('⏱ 15М: '+(down?'нисходящий':'восходящий')+' тренд');
  }
  lines.push('🔮 Только прогноз, не разрешение на сделку.');
  if(deadline)lines.push('⏰ Действует до '+deadline);
  return {title:'🔮 ПРОГНОЗ '+movement+' · '+name,message:lines.join('\n'),
   status:'FORECAST',direction,early:true,forecast:true};
 }
 // It is not enough to detect a 5m direction; a reviewed WEEX entry needs
 // positive estimated costs. The final account-specific preflight is separate.
 const ready=s?.exchange==='WEEX'&&s?.advisor?.status==='REVIEW'&&
  s?.entryQuality?.ok===true&&s?.costReview?.status==='PASS_ESTIMATE';
 if(!ready){
  return {title:'🔮 ПРОГНОЗ '+movement+' · '+name,
   message:icon+' Направление по 5М/15М: '+(down?'вниз':'вверх')+
    '\nГотового входа с проверенным расчётным риском нет. Это только прогноз.',
   status:'FORECAST',direction,early:false,forecast:true};
 }
 const lines=[
  'WEEX Futures · '+icon+' '+direction,
  '📍 Цена для проверки входа: '+price+' USDT',
  '🛑 SL: '+priceText(s.stop)+' · 🎯 расчётный TP: '+priceText(s.take),
  'SL '+String(s.stop)+' · TP '+String(s.take),
  '👆 Открой торговый модуль, перепроверь цену, риск и подтверди лично.',
  '⚠️ Не ордер. Перед отправкой обязательны проверка счёта и Passkey.'
 ];
 const rr=s.costReview?.netRR;
 if(Number.isFinite(rr)&&rr>0)lines.push('📊 Расчётный R/R после расходов: '+rr.toFixed(2)+':1');
 if(deadline)lines.push('⏰ Сигнал действует до '+deadline);
 return {title:'🟢 ВХОД '+direction+' · '+name,
  message:lines.join('\n'),status:'CHECK',direction,early:false,forecast:false};
}
