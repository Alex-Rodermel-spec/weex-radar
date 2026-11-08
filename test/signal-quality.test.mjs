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
