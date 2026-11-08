// Evaluation of *actual sent* ntfy confirmed alerts, not historical candidate guesses.
// Pure functions; no order execution, account access or persistence.
export const WINDOW_MINUTES=110;
export const HORIZON_MINUTES=60;
const MINUTE=60_000;
const finitePositive=x=>Number.isFinite(x)&&x>0;

export function parseConfirmedNotification(message){
 if(!message||message.event!=='message'||typeof message.title!=='string'||
   typeof message.message!=='string')return null;
 // The 1m EARLY WATCH, tests and browser notifications are not confirmed entries.
 const legacy=message.title.match(/^(?:🔔 ОБЫЧНЫЙ|🟣 СИЛЬНЫЙ) ([A-Z0-9]{2,24}) (LONG|SHORT)$/u);
 const modern=message.title.match(/^(?:🟢 ПРОВЕРИТЬ|🔴 ПРОПУСТИТЬ|🟡 ПРОВЕРИТЬ РАСХОДЫ) · (🟣 СИЛЬНЫЙ|🔔 ОБЫЧНЫЙ) ([A-Z0-9]{2,24}) (LONG|SHORT)$/u);
 if(!legacy&&!modern)return null;
 const symbol=modern?modern[2]:legacy[1];
 const direction=modern?modern[3]:legacy[2];
 const level=modern?(modern[1]==='🟣 СИЛЬНЫЙ'?'STRONG':'NORMAL'):
  message.title.startsWith('🟣')?'STRONG':'NORMAL';
 const price=message.message.match(/(?:^|·)\s*цена\s+([0-9]+(?:\.[0-9]+)?)\s+USDT/u)||
  message.message.match(/📍 Вход:\s*([0-9]+(?:\.[0-9]+)?)\s+USDT/u);
 const stop=message.message.match(/(?:^|·)\s*SL\s+([0-9]+(?:\.[0-9]+)?)/u)||
  message.message.match(/🛑 Стоп \(SL\):\s*([0-9]+(?:\.[0-9]+)?)/u);
 const take=message.message.match(/(?:^|·)\s*TP\s+([0-9]+(?:\.[0-9]+)?)/u)||
  message.message.match(/✅ Прибыль \(TP\):\s*([0-9]+(?:\.[0-9]+)?)/u);
 const exchange=message.message.match(/^([A-Za-z]+)\s*·/u)?.[1];
 const entry=Number(price?.[1]),sl=Number(stop?.[1]),tp=Number(take?.[1]);
 const sentAt=Number(message.time)*1000;
 if(exchange!=='WEEX'||![entry,sl,tp].every(finitePositive)||
    !Number.isSafeInteger(Number(message.time))||sentAt<=0)return null;
 if(direction==='LONG'&&!(sl<entry&&entry<tp)||
    direction==='SHORT'&&!(tp<entry&&entry<sl))return null;
 const risk=Math.abs(entry-sl),reward=Math.abs(tp-entry);
 if(risk/entry>0.20||reward/entry>0.40)return null;
 return {
  symbol,direction,level,
  entry,stop:sl,take:tp,sentAt,
  // Compare experimental "skip" label to TP/SL without changing what was sent.
  shadow:message.message.includes('· ТЕСТ: ПРОПУСТИТЬ')?'SKIP':
   message.message.includes('· ТЕСТ: БЕЗ ЗАМЕЧАНИЙ')?'OBSERVE':'LEGACY',
  // Stable internal id, not a ntfy topic, account identifier or secret.
  id:typeof message.sequence_id==='string'&&/^[a-f0-9]{32}$/.test(message.sequence_id)
     ?message.sequence_id:null
 };
}

export function evaluateNotification(signal,candles,now=Date.now()){
 if(!signal||!Array.isArray(candles)||!candles.length)
  return {status:'NO_DATA',at:null};
 const start=Math.floor(signal.sentAt/MINUTE)*MINUTE;
 const horizon=signal.sentAt+HORIZON_MINUTES*MINUTE;
 const eligible=candles.filter(c=>
   Number.isFinite(c.time)&&Number.isFinite(c.closeTime)&&
   c.time>=start&&c.closeTime<=horizon&&c.closeTime<=now-1000)
   .sort((a,b)=>a.time-b.time);
 if(!eligible.length)return {status:now>=horizon?'NO_DATA':'PENDING',at:null};
 if(eligible[0].time!==start)return {status:'NO_DATA',at:null};
 let expected=start;
 for(const bar of eligible){
  if(bar.time!==expected)return {status:'NO_DATA',at:null};
  expected=bar.closeTime;
  if(![bar.high,bar.low].every(Number.isFinite)||bar.high<bar.low)
    return {status:'NO_DATA',at:null};
  const hitTake=signal.direction==='LONG'?bar.high>=signal.take:bar.low<=signal.take;
  const hitStop=signal.direction==='LONG'?bar.low<=signal.stop:bar.high>=signal.stop;
  if(hitTake||hitStop){
   // We cannot know whether the touch happened BEFORE the ntfy message
   // within its starting minute; do not count it as a win or loss.
   if(bar.time===start)return {status:'INTRABAR',at:bar.closeTime};
   if(hitTake&&hitStop)return {status:'AMBIGUOUS',at:bar.closeTime};
   return {status:hitTake?'TP':'SL',at:bar.closeTime};
  }
 }
 // Do not inspect the final partial minute: its within-minute ordering is unknown.
 if(now>=horizon&&expected>=Math.floor(horizon/MINUTE)*MINUTE)
  return {status:'TIMEOUT',at:horizon};
 return {status:now>=horizon?'NO_DATA':'PENDING',at:null};
}

export function aggregateQuality(rows){
 const counts={TP:0,SL:0,PENDING:0,TIMEOUT:0,AMBIGUOUS:0,INTRABAR:0,NO_DATA:0};
 const direction={LONG:{TP:0,SL:0},SHORT:{TP:0,SL:0}};
 for(const row of rows){
  if(!(row.status in counts))continue;
  counts[row.status]++;
  if((row.status==='TP'||row.status==='SL')&&row.direction in direction)
    direction[row.direction][row.status]++;
 }
 const resolved=counts.TP+counts.SL;
 return {total:rows.length,...counts,resolved,
  observedWinRatePct:resolved?Math.round(counts.TP/resolved*1000)/10:null,
  byDirection:direction};
}


export function aggregateShadowQuality(rows){
 const groups=Object.fromEntries(['SKIP','OBSERVE','LEGACY'].map(label=>
  [label,{total:0,TP:0,SL:0,resolved:0,observedWinRatePct:null}]));
 for(const row of rows){
  const category=row?.shadow in groups?row.shadow:'LEGACY';
  const group=groups[category];group.total++;
  if(row.status==='TP'||row.status==='SL'){group[row.status]++;group.resolved++;}
 }
 for(const group of Object.values(groups)){
  group.observedWinRatePct=group.resolved?Math.round(group.TP/group.resolved*1000)/10:null;
 }
 return groups;
}
