import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {WINDOW_MINUTES,HORIZON_MINUTES,parseConfirmedNotification,
 evaluateNotification,aggregateQuality} from '../lib/signal-quality.mjs';

const minute=60_000;
const stamp=Date.UTC(2026,10,8,12,0,15);
function alert(direction='SHORT',time=stamp){
 return {event:'message',title:'🔔 ОБЫЧНЫЙ LINKUSDT '+direction,
  topic:'unused-secret',sequence_id:'a'.repeat(32),
  message: direction==='SHORT'?
   'WEEX · цена 10.7015 USDT · SL 10.7277 · TP 10.6596 · свеча 12:00:00 · отправка 12:00:15':
   'WEEX · цена 10.7015 USDT · SL 10.6596 · TP 10.7277 · свеча 12:00:00 · отправка 12:00:15',
  time:Math.floor(time/1000)};
}
function bars(num,overrides={}){
 const time=Math.floor(stamp/minute)*minute;
 return Array.from({length:num},(_,i)=>({
  time:time+i*minute,closeTime:time+(i+1)*minute,
  high:10.705,low:10.695,...(overrides[i]||{})
 }));
}
test('only confirmed signals with consistent 5m TP/SL from WEEX are accepted',()=>{
 const parsed=parseConfirmedNotification(alert());
 assert.equal(parsed.symbol,'LINKUSDT');
 assert.equal(parsed.direction,'SHORT');
 assert.equal(parsed.entry,10.7015);
 assert.equal(parsed.stop,10.7277);
 assert.equal(parsed.take,10.6596);
 assert.equal(parsed.sentAt,Math.floor(stamp/1000)*1000);
 assert.equal(parseConfirmedNotification({...alert(),title:'⚡ EARLY WATCH LINKUSDT SHORT'}),null);
 assert.equal(parseConfirmedNotification({...alert(),title:'🧪 ТЕСТ SHORT'}),null);
 assert.equal(parseConfirmedNotification({...alert(),message:alert().message.replace('WEEX','Bybit')}),null);
 assert.equal(parseConfirmedNotification({...alert(),message:alert().message.replace('10.7277','10.6000')}),null);
});
test('four-state ntfy confirmed alerts are still recorded with exact raw SL/TP',()=>{
 const msg={event:'message',time:Math.floor(stamp/1000),
  sequence_id:'b'.repeat(32),
  title:'🟢 ПРОВЕРИТЬ · LINKUSDT LONG · 🟣 СИЛЬНЫЙ',
  message:'📈 РОСТ · WEEX\n📍 Вход: 10,7015 USDT\n'+
   '✅ Прибыль (TP): 10,73 · 🛑 Стоп (SL): 10,66\n'+
   'SL 10.6596 · TP 10.7277\n'+
   'Чистый R/R (модель): 1.87:1\n⚠️ Ретест удержан' };
 const found=parseConfirmedNotification(msg);
 assert.ok(found);
 assert.equal(found.entry,10.7015);
 assert.equal(found.stop,10.6596);
 assert.equal(found.take,10.7277);
 assert.equal(found.symbol,'LINKUSDT');
 assert.equal(found.direction,'LONG');
 assert.equal(found.level,'STRONG');
 assert.equal(found.shadow,'LEGACY');
 assert.equal(found.decisionAtAlert,'CHECK');
 assert.equal(found.netRRAtAlert,1.87);
 assert.equal(found.id,'b'.repeat(32));
 const red=parseConfirmedNotification({...msg,
  title:'🔴 ПРОПУСТИТЬ · LINKUSDT LONG · 🔔 ОБЫЧНЫЙ'});
 assert.ok(red);
 assert.equal(red.level,'NORMAL');
 assert.equal(red.decisionAtAlert,'SKIP');
 const amber=parseConfirmedNotification({...msg,
  title:'🟡 ЖДАТЬ · LINKUSDT LONG · 🔔 ОБЫЧНЫЙ'});
 assert.ok(amber);
 assert.equal(amber.decisionAtAlert,'WAIT');
 assert.equal(parseConfirmedNotification(alert()).decisionAtAlert,'LEGACY');
 assert.equal(parseConfirmedNotification(alert()).netRRAtAlert,null);
});
test('current WEEX ENTRY notifications enter read-only history using original quote',()=>{
 const time=Math.floor(stamp/1000);
 const msg={event:'message',time,sequence_id:'c'.repeat(32),
  title:'🟢 ВХОД LONG · XRPUSDT',
  message:'WEEX Futures · 📈 LONG\n'+
   '📍 Цена для проверки входа: 1,01 USDT\n'+
   '📌 Точная котировка наблюдения: 1.010012345 USDT\n'+
   '🛑 SL: 0,98 · 🎯 расчётный TP: 1,04\n'+
   'SL 0.98 · TP 1.04\n'+
   '📊 Расчётный R/R после расходов: 1.53:1\n'+
   '⏰ Сигнал действует до 13:02:00'};
 const p=parseConfirmedNotification(msg);
 assert.ok(p);assert.equal(p.symbol,'XRPUSDT');
 assert.equal(p.direction,'LONG');assert.equal(p.decisionAtAlert,'CHECK');
 assert.equal(p.entry,1.010012345);assert.equal(p.stop,.98);
 assert.equal(p.take,1.04);assert.equal(p.netRRAtAlert,1.53);
 assert.equal(p.expiresAt,Date.UTC(2026,10,8,12,2,0));
 assert.equal(parseConfirmedNotification({...msg,title:'🔮 ПРОГНОЗ РОСТА · XRPUSDT'}),null);
 assert.equal(parseConfirmedNotification({...msg,message:msg.message.replace('WEEX Futures','Bybit Futures')}),null);
});

test('SHIB prices with localized commas are parsed; forecasts never pollute confirmed history',()=>{
 const msg={event:'message',time:Math.floor(stamp/1000),
  title:'🔴 ПРОПУСТИТЬ · 1000SHIBUSDT SHORT · 🔔 ОБЫЧНЫЙ',
  message:'📉 ПАДЕНИЕ · WEEX\n📍 Вход: 0,004445 USDT\n'+
   '✅ Прибыль (TP): 0,00443028 · 🛑 Стоп (SL): 0,00445236\n'+
   'SL 0.0044523591435890126 · TP 0.004430281712821975\n'+
   '⚠️ Пробой уже прошёл' };
 const found=parseConfirmedNotification(msg);
 assert.ok(found);
 assert.equal(found.symbol,'1000SHIBUSDT');
 assert.equal(found.direction,'SHORT');
 assert.equal(found.entry,0.004445);
 assert.equal(found.stop,0.0044523591435890126);
 assert.equal(found.take,0.004430281712821975);
 assert.equal(parseConfirmedNotification({...msg,
  title:'🔮 ПРОГНОЗ · 1000SHIBUSDT SHORT · 🟡 ЖДАТЬ'}),null);
 assert.equal(parseConfirmedNotification({...msg,
  title:'🟡 ЖДАТЬ · 1000SHIBUSDT SHORT · ⚡ EARLY WATCH'}),null);
 assert.equal(parseConfirmedNotification({...msg,
  message:msg.message.replace('· WEEX','· Bybit')}),null);
 assert.equal(parseConfirmedNotification({...msg,
  message:msg.message.replace('SL 0.0044523591435890126','SL 0.00442')}),null);
});

test('short and long simulated TP/SL are symmetric, only after the alert minute',()=>{
 const short=parseConfirmedNotification(alert());
 const long=parseConfirmedNotification(alert('LONG'));
 assert.equal(evaluateNotification(short,bars(5,{1:{low:10.65}}),stamp+5*minute).status,'TP');
 assert.equal(evaluateNotification(short,bars(5,{1:{high:10.73}}),stamp+5*minute).status,'SL');
 assert.equal(evaluateNotification(long,bars(5,{1:{high:10.73}}),stamp+5*minute).status,'TP');
 assert.equal(evaluateNotification(long,bars(5,{1:{low:10.65}}),stamp+5*minute).status,'SL');
});
test('first partial minute and same-candle TP plus SL are NOT scored as wins',()=>{
 const s=parseConfirmedNotification(alert());
 assert.equal(evaluateNotification(s,bars(5,{0:{low:10.65}}),stamp+5*minute).status,'INTRABAR');
 assert.equal(evaluateNotification(s,bars(5,{1:{low:10.65,high:10.74}}),stamp+5*minute).status,'AMBIGUOUS');
});
test('incomplete market history fails closed instead of inventing a win or loss',()=>{
 const s=parseConfirmedNotification(alert());
 assert.equal(evaluateNotification(s,bars(4).slice(1),stamp+5*minute).status,'NO_DATA');
 assert.equal(evaluateNotification(s,bars(4).filter(x=>x.time!==bars(4)[2].time),stamp+5*minute).status,'NO_DATA');
 assert.equal(evaluateNotification(s,[],stamp+5*minute).status,'NO_DATA');
});
test('time-limited reviews never count levels hit after the horizon',()=>{
 const s=parseConfirmedNotification(alert());
 const inputs=bars(63,{60:{low:10.64}});
 assert.equal(evaluateNotification(s,inputs,stamp+63*minute).status,'TIMEOUT');
 assert.equal(evaluateNotification(s,bars(5),stamp+5*minute).status,'PENDING');
});
test('audited win rate excludes uncertain, expired, and pending entries',()=>{
 const a=aggregateQuality([
  {status:'TP',direction:'LONG'},{status:'SL',direction:'SHORT'},
  {status:'INTRABAR',direction:'SHORT'},{status:'PENDING',direction:'LONG'},
  {status:'TIMEOUT',direction:'LONG'},{status:'NO_DATA',direction:'SHORT'}
 ]);
 assert.equal(a.total,6);
 assert.equal(a.resolved,2);
 assert.equal(a.observedWinRatePct,50);
 assert.equal(a.byDirection.SHORT.SL,1);
 assert.equal(aggregateQuality([]).observedWinRatePct,null);
});
test('browser dashboard is valid inline JavaScript and read only',()=>{
 const html=readFileSync(new URL('../quality.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'quality.html'}));
 const ui=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(ui,/href="\/quality\.html"/);
 const api=readFileSync(new URL('../lib/signal-quality-route.mjs',import.meta.url),'utf8');
 assert.match(api,/NTFY_TOPIC/);
 const signalsApi=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(signalsApi,/req.query\?\.mode==='quality'/);
 assert.match(signalsApi,/signal-quality-route/);
 assert.match(api,/historyOfSentSignals/);
 assert.match(api,/evaluateNotification/);
 assert.doesNotMatch(api,/trade-confirm|trade-prepare|\/capi\/v3\/order|@vercel\/blob|WEEX_API_SECRET/);
 assert.equal(WINDOW_MINUTES,110);
 assert.equal(HORIZON_MINUTES,60);
});
