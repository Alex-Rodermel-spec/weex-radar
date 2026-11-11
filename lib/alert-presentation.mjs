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
// Only the readable ntfy BODY changes here; the title, action status,
// entry economics, candle timestamps, expiry, and notification gates stay
// untouched. The raw "SL <n> · TP <n>" line is deliberately retained for
// lossless journal replay; rounded labels are FOR DISPLAY ONLY.
export function formatPhoneAlert(s,{early=false,deadline=null}={}){
 if(early&&s.watchType==='PRE_BREAK'&&s.forecast?.mode==='PRE_BREAK_SCENARIO'){
  const f=s.forecast,down=f.direction==='SHORT';
  const name=String(s.symbol||'').replace(/[^A-Z0-9]/g,'').slice(0,24);
  const title='🔮 ПРОГНОЗ · '+name+' '+f.direction+' · 🟡 ЖДАТЬ';
  const lines=[
   '👀 НАБЛЮДАЙ. НЕ ВХОДИ.',
   (down?'📉 Возможное ПАДЕНИЕ':'📈 Возможный РОСТ')+' · WEEX',
   'WEEX · 📍 Сейчас: '+priceText(s.livePrice??s.closePrice)+' USDT',
   '🔑 Подтверждение: '+(down?'ниже ':'выше ')+priceText(f.triggerPrice),
   '❌ Отмена сценария: '+(down?'выше ':'ниже ')+priceText(f.invalidationPrice),
   '⏳ Жди отдельного подтверждения 5М.'
  ];
  if(deadline)lines.push('⏰ До '+deadline);
  return {title,message:lines.join('\n'),status:'WAIT',direction:f.direction,
   badge:'🟡 ЖДАТЬ',strength:'🔮 ПРОГНОЗ',early:true,forecast:true};
 }
 const v=alertPresentation(s,{early});
 const price=priceText(s.livePrice??s.price??s.closePrice);
 const movement=v.direction==='LONG'?'📈 РОСТ':'📉 ПАДЕНИЕ';
 if(early){
  const lines=['👀 ЖДИ подтверждения 5М. НЕ ВХОДИ.',
   movement+' · '+s.exchange,
   '📍 Сейчас: '+price+' USDT'];
  if(deadline)lines.push('⏰ До '+deadline);
  return {title:v.title,message:lines.join('\n'),...v};
 }
 const action=v.status==='CHECK'?
  '🟢 ПРОВЕРЬ ВХОД ВРУЧНУЮ. НЕ АВТОВХОД.':
  v.status==='SKIP'?'🔴 ПРОПУСТИ. НЕ ВХОДИ.':
  '🟡 ПОДОЖДИ. НЕ ВХОДИ.';
 const lines=[action,movement+' · '+s.exchange,
  '📍 Вход: '+price+' USDT'];
 // A single easy-to-read pair plus one strictly exact pair, so the
 // historical ntfy parser can still score unrounded TP/SL correctly.
 const stop=valid(Number(s.stop))?String(s.stop):'—';
 const take=valid(Number(s.take))?String(s.take):'—';
 lines.push('🎯 Цель: '+priceText(s.take)+' · 🛑 Стоп: '+priceText(s.stop));
 lines.push('SL '+stop+' · TP '+take);
 if(s.costReview?.mode==='SHADOW_COSTS'&&Number.isFinite(s.costReview.netRR))
  lines.push('Чистый R/R (модель): '+s.costReview.netRR.toFixed(2)+':1');
 if(v.status==='CHECK'&&Number.isFinite(s.closedFiveMinuteMoveBps)){
  const bps=s.closedFiveMinuteMoveBps;
  const shown=(bps>0?'+':bps<0?'-':'')+
   (Math.abs(bps)/100).toFixed(2).replace('.',',')+'%';
  lines.push('📊 За 5М до сигнала: '+shown+
   (bps>=0?' по направлению':' против направления'));
  if(bps>=10)lines.push('⚠️ Цена уже сдвинулась. Не догоняй.');
 }
 if(v.status==='CHECK'){
  const retest=s.retest?.[v.direction];
  lines.push(retest?.status==='CONFIRMED'&&retest.trendAligned===true?
   '✅ Ретест удержан. Проверь текущую цену.':
   '⚠️ Ретест не подтверждён. Риск выше.');
 }else lines.push('⚠️ '+v.reason);
 const trap=s.trapReview?.byDirection?.[v.direction];
 const names={HIGH_SWEEP:'вынос верхней ликвидности',
  LOW_SWEEP:'вынос нижней ликвидности',
  BULL_TRAP:'ложный пробой вверх',BEAR_TRAP:'ложный пробой вниз'};
 if(trap&&Number.isInteger(trap.ageBars)&&trap.ageBars<=2&&names[trap.kind])
  lines.push('⚠️ Возможная ловушка: '+names[trap.kind]);
 if(deadline)lines.push('⏰ До '+deadline);
 else lines.push('⏰ Проверь срок и текущую цену.');
 return {title:v.title,message:lines.join('\n'),...v};
}
