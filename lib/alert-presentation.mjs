// Display and advisory labels only: no order is ever authorized here.
// Strength, retest evidence and fee/risk are independent.
import {COST_MIN_NET_RR} from './net-costs.mjs';
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
   status='SKIP';reason='Чистый R/R ниже '+String(COST_MIN_NET_RR).replace('.',',')+' (модель)';
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
export function formatPhoneAlert(s,{early=false,deadline=null}={}){
 if(early&&s.watchType==='PRE_BREAK'&&s.forecast?.mode==='PRE_BREAK_SCENARIO'){
  const f=s.forecast,down=f.direction==='SHORT';
  const name=String(s.symbol||'').replace(/[^A-Z0-9]/g,'').slice(0,24);
  const title='🔮 ПРОГНОЗ · '+name+' '+f.direction+' · 🟡 ЖДАТЬ';
  const lines=[
   '👀 ЧТО ДЕЛАТЬ: СМОТРИМ. НЕ ВХОДИМ.',
   (down?'📉 Возможное ПАДЕНИЕ':'📈 Возможный РОСТ')+
    ' в ближайшие '+f.horizonMinutes+' мин',
   'WEEX · 📍 Сейчас: '+priceText(s.livePrice??s.closePrice)+' USDT',
   '🔑 Подтверждение: '+(down?'ниже ':'выше ')+priceText(f.triggerPrice),
   '❌ Отмена сценария: '+(down?'выше ':'ниже ')+priceText(f.invalidationPrice),
   '📊 Тренд 1м/5м/15м · RSI 1м '+f.rsi1+' · объём x'+f.volumeRatio,
   '🟡 ПРОГНОЗ ДО ПРОБОЯ. НЕ ВХОДИТЬ без отдельного подтверждения.'
  ];
  if(deadline)lines.push('⏰ Актуален до '+deadline);
  return {title,message:lines.join('\n'),status:'WAIT',direction:f.direction,
   badge:'🟡 ЖДАТЬ',strength:'🔮 ПРОГНОЗ',early:true,forecast:true};
 }
 const v=alertPresentation(s,{early});
 const price=priceText(s.livePrice??s.price??s.closePrice);
 const movement=v.direction==='LONG'?'📈 РОСТ':'📉 ПАДЕНИЕ';
 const action=v.status==='CHECK'?
  '🟢 ЧТО ДЕЛАТЬ: ПРОВЕРЬ ЦЕНУ И РИСК. НЕ АВТОВХОД.':
  v.status==='SKIP'?
   '🔴 ЧТО ДЕЛАТЬ: ПРОПУСТИ. НЕ ВХОДИ.':
   '🟡 ЧТО ДЕЛАТЬ: ЖДИ ПОДТВЕРЖДЕНИЯ. НЕ ВХОДИ.';
 const lines=[action,movement+' · '+s.exchange,'📍 Вход: '+price+' USDT'];
 // Evidence ONLY: the 5m candle has CLOSED before a CHECK notice exists.
 // Show what already moved, not a probability or a new trade gate.
 if(!early&&v.status==='CHECK'&&Number.isFinite(s.closedFiveMinuteMoveBps)){
  const bps=s.closedFiveMinuteMoveBps;
  const shown=(bps>0?'+':bps<0?'-':'')+
   (Math.abs(bps)/100).toFixed(2).replace('.',',')+'%';
  lines.push('📊 За закрытую 5М свечу: '+shown+' '+
   (bps>=0?'по прогнозу':'против прогноза')+' (уже произошло)');
  if(bps>=10)lines.push('⚠️ Движение уже было заметным. Не догоняй цену — проверь, не поздно ли.');
 }
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
 if(!early){
  const trap=s.trapReview?.byDirection?.[v.direction];
  const names={HIGH_SWEEP:'вынос верхней ликвидности',LOW_SWEEP:'вынос нижней ликвидности',
   BULL_TRAP:'ложный пробой вверх',BEAR_TRAP:'ложный пробой вниз'};
  if(trap&&Number.isInteger(trap.ageBars)&&trap.ageBars<=2&&names[trap.kind])
   lines.push('⚠️ ТЕСТ ЛОВУШКИ: '+names[trap.kind]+
    ' · риск для '+v.direction+' · сигнал не блокируется');
 }
 lines.push('⚠️ '+v.reason);
 if(!early&&v.status==='CHECK')
  lines.push('🔎 Сравни цену с входом, TP/SL и расходами. Если цена ушла или риск не подходит — ПРОПУСТИ.');
 if(deadline)lines.push('⏰ До '+deadline+' · '+(early?'НЕ ВХОДИТЬ':'Проверь актуальную цену'));
 else lines.push(early?'⏳ Ждать подтверждения 5м · НЕ ВХОДИТЬ':'⚠️ Проверь актуальную цену');
 return {title:v.title,message:lines.join('\n'),...v};
}
