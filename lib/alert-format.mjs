// Read-only, user-facing presentation of existing live signals.
// Strength and risk are independent. No orders, no signal filtering.
const num=v=>{
 const n=Number(v);
 if(!Number.isFinite(n)||n<=0)return '—';
 return n.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:n<0.0001?12:n<1?9:8});
};
const clock=stamp=>new Date(stamp).toLocaleTimeString('ru-RU',{
 timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
export function classifyNotice(kind,s){
 if(!s||!['LONG','SHORT'].includes(s.direction))return null;
 if(kind==='early')return {risk:'WAIT',status:'🟡 ЖДАТЬ',
  strength:'⚡ EARLY WATCH',strong:false,reason:'Ждать подтверждения 5м'};
 if(kind!=='confirmed')return null;
 const strong=s.level==='STRONG',strength=strong?'🟣 СИЛЬНЫЙ':'🔔 ОБЫЧНЫЙ',
  cost=s.costReview,retest=s.retest?.[s.direction];
 let risk='REVIEW',status='🟢 ПРОВЕРИТЬ',
  reason='Основные фильтры пройдены. Это не гарантия прибыли.';
 if(cost?.status==='COSTS_EXCEED_TP'){
  risk='SKIP';status='🔴 ПРОПУСТИТЬ';
  reason='РАСХОДЫ: TP меньше предполагаемых расходов (модель).';
 }else if(cost?.status==='LOW_NET_RR'){
  risk='SKIP';status='🔴 ПРОПУСТИТЬ';
  reason='РАСХОДЫ: чистый R/R ниже 1,5 (модель).';
 }else if(retest?.status==='FAILED'){
  risk='SKIP';status='🔴 ПРОПУСТИТЬ';
  reason='Ретест: уровень не удержан (экспериментальная проверка).';
 }else if(s.shadowFilter?.mode==='SHADOW'&&s.shadowFilter.warning){
  risk='SKIP';status='🔴 ПРОПУСТИТЬ';
  reason='Экспериментальный фильтр структуры рынка предупреждает о риске.';
 }else if(cost?.mode!=='SHADOW_COSTS'||cost.status!=='PASS_ESTIMATE'){
  risk='CAUTION';status='🟡 ПРОВЕРИТЬ РАСХОДЫ';
  reason='Нет надёжной оценки расходов для этого рынка.';
 }
 return {risk,status,strength,strong,reason};
}
export function formatNotice(kind,s,{sentAt=Date.now(),compact=false}={}){
 const state=classifyNotice(kind,s);if(!state)return null;
 const title=state.status+' · '+state.strength+' '+(s.symbol||'—')+' '+s.direction;
 const exchange=['WEEX','Bybit'].includes(s.exchange)?s.exchange:'—';
 const dir=s.direction==='LONG'?'📈 LONG — ожидаем рост':'📉 SHORT — ожидаем падение';
 const stamp=Number.isFinite(s.candleCloseTime)?clock(s.candleCloseTime):'—';
 const until=Number.isFinite(s.expiresAt)?clock(s.expiresAt):'—';
 const lag=Number.isFinite(s.candleCloseTime)?Math.max(0,Math.round((sentAt-s.candleCloseTime)/1000)):'—';
 const footer='🕒 свеча '+stamp+' · отправка '+clock(sentAt)+' · задержка '+lag+'с · до '+until;
 const price=num(s.livePrice??s.price??s.closePrice);
 const early=kind==='early';
 if(early)return {title,body:[
  exchange+' · 1м · '+dir,
  '📍 Цена наблюдения: '+price+' USDT',
  '🟡 ЖДАТЬ подтверждения 5м · TP/SL пока нет',
  footer,'⚠️ НЕ ВХОДИТЬ без подтверждения 5м.'
 ].join(compact?' · ':'\n'),...state};
 const lines=[
  exchange+' · 5м · '+dir,
  '📍 Вход: '+price+' USDT',
  '✅ Прибыль (TP): '+num(s.take),
  '🛑 Стоп (SL): '+num(s.stop),
  '🔎 Риск: '+state.reason,
  state.strong?'🟣 Сила: СИЛЬНЫЙ (не гарантия).':'🔔 Сила: ОБЫЧНЫЙ.'
 ];
 const c=s.costReview;
 lines.push(c?.mode==='SHADOW_COSTS'&&Number.isFinite(c.netRR)?
  '💰 Чистый R/R: '+c.netRR.toFixed(2)+':1 (модель расходов).':
  '💰 Расходы: не подтверждены.');
 if(!compact){
  if(s.shadowFilter?.mode==='SHADOW')
   lines.push('🧪 Структура · ТЕСТ: '+(s.shadowFilter.warning?'ПРОПУСТИТЬ':'БЕЗ ЗАМЕЧАНИЙ'));
  const r=s.retest?.[s.direction];
  lines.push('🔁 Ретест: '+(r?.status==='FAILED'?'уровень не удержан':
   r?.status==='CONFIRMED'&&r.trendAligned?'уровень удержан':'не подтверждён'));
 }
 lines.push(footer,'⚠️ Перед входом проверь котировку и точность цены. Прибыль не гарантирована.');
 return {title,body:lines.join(compact?' · ':'\n'),...state};
}
