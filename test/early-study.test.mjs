import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseEarlyNotification,normalizeEarlyCandles,evaluateEarlyDirection,
 pairConfirmation,summarizeEarlyStudy,EARLY_HORIZONS} from '../lib/early-study.mjs';
const MINUTE=60000;
const T=Date.UTC(2026,10,9,12,0,25);
function notify({direction='SHORT',kind='BREAKOUT',symbol='BTCUSDT',price=100}={}){
 return {event:'message',topic:'secret-never-show',time:Math.floor(T/1000),
  sequence_id:'a'.repeat(32),
  title:kind==='PRE_BREAK'?'🔮 ПРОГНОЗ · '+symbol+' '+direction+' · 🟡 ЖДАТЬ':
   '🟡 ЖДАТЬ · '+symbol+' '+direction+' · ⚡ EARLY WATCH',
  message:kind==='PRE_BREAK'?
   '📉 Возможное ПАДЕНИЕ в ближайшие 5 мин\nWEEX · 📍 Сейчас: '+price+' USDT\n🔑 Подтверждение: ниже 99':
   '📉 ПАДЕНИЕ · WEEX\n📍 Вход: '+price+' USDT\n⚠️ ЖДАТЬ подтверждения 5м'};
}
function makeBars(start=T,close=99,length=30){
 const first=Math.ceil(start/MINUTE)*MINUTE;
 return Array.from({length},(_,i)=>({time:first+i*MINUTE,closeTime:first+(i+1)*MINUTE,
  open:100,high:101,low:98,close}));
}
test('parse only real WEEX early watch and pre-break ntfy notifications',()=>{
 const base=parseEarlyNotification(notify());
 assert.equal(base.direction,'SHORT');
 assert.equal(base.symbol,'BTCUSDT');
 assert.equal(base.entry,100);
 assert.equal(base.watchType,'BREAKOUT');
 assert.equal(parseEarlyNotification(notify({kind:'PRE_BREAK'})).watchType,'PRE_BREAK');
 assert.equal(parseEarlyNotification({...notify(),title:'🔔 ОБЫЧНЫЙ BTCUSDT SHORT'}),null);
 assert.equal(parseEarlyNotification({...notify(),message:notify().message.replace('WEEX','Bybit')}),null);
 assert.equal(parseEarlyNotification({...notify(),message:'📉 ПАДЕНИЕ · WEEX'}),null);
 assert.equal(parseEarlyNotification({...notify(),time:'invalid'}),null);
 const commas=notify({price:'0,004445',symbol:'1000SHIBUSDT'});
 assert.equal(parseEarlyNotification(commas).entry,0.004445);
});
test('direction is measured only from complete post-notification minute candles',()=>{
 const alert=parseEarlyNotification(notify());
 const market=makeBars();
 const early=evaluateEarlyDirection(alert,market,5,T+3*MINUTE);
 assert.equal(early.status,'PENDING');
 const atFive=evaluateEarlyDirection(alert,market,5,T+6*MINUTE);
 assert.equal(atFive.status,'OBSERVED');
 assert.equal(atFive.moveBps,100);
 assert.equal(atFive.favorableBps,200);
 assert.equal(atFive.adverseBps,-100);
 const long={...alert,direction:'LONG'};
 assert.equal(evaluateEarlyDirection(long,market,5,T+6*MINUTE).moveBps,-100);
});
test('missing minute is unknown, never fabricated as successful',()=>{
 const alert=parseEarlyNotification(notify());
 const bars=makeBars();
 assert.equal(evaluateEarlyDirection(alert,bars.filter((_,i)=>i!==3),5,T+6*MINUTE).status,'NO_DATA');
 assert.equal(evaluateEarlyDirection(alert,null,5,T+6*MINUTE).status,'NO_DATA');
 assert.equal(evaluateEarlyDirection(alert,[],45,T+60*MINUTE).status,'NO_DATA');
});
test('candles must be closed, internally consistent, and from the relevant time window',()=>{
 const rows=makeBars().map(b=>[b.time,b.open,b.high,b.low,b.close,100]);
 rows.push([T+80*MINUTE,100,101,99,100,100]);
 rows.push([T+2*MINUTE,100,90,99,100,100]);
 const normalized=normalizeEarlyCandles(rows,T+32*MINUTE);
 assert.equal(normalized.length,30);
 assert.equal(normalized[0].time,Math.ceil(T/MINUTE)*MINUTE);
});
test('later confirmation penalty is directional and never claims an early trade',()=>{
 const short=parseEarlyNotification(notify());
 const confirm=[{symbol:'BTCUSDT',direction:'SHORT',entry:98,sentAt:T+6*MINUTE}];
 assert.equal(pairConfirmation(short,confirm).chaseBps,200);
 assert.equal(pairConfirmation(short,confirm).delayMinutes,6);
 assert.equal(pairConfirmation(short,[{...confirm[0],sentAt:T+40*MINUTE}]),null);
 const long={...short,direction:'LONG'};
 assert.equal(pairConfirmation(long,[{...confirm[0],direction:'LONG'}]).chaseBps,-200);
});
test('summary deduplicates notifications and clearly separates observed/pending samples',()=>{
 const early=parseEarlyNotification(notify());
 const noCandles=new Map([['BTCUSDT',makeBars()]]);
 const sum=summarizeEarlyStudy([early,early],noCandles,
  [{symbol:'BTCUSDT',direction:'SHORT',entry:98,sentAt:T+6*MINUTE}],T+16*MINUTE);
 assert.equal(sum.totalEarly,1);
 assert.equal(sum.windows[5].observed,1);
 assert.equal(sum.windows[15].observed,1);
 assert.equal(sum.windows[30].pending,1);
 assert.equal(sum.windows[5].favorablePct,100);
 assert.equal(sum.byType.BREAKOUT.windows[5].favorablePct,100);
 assert.equal(sum.byType.PRE_BREAK.windows[5].favorablePct,null);
 assert.equal(sum.pairs.confirmedWithin30m,1);
 assert.deepEqual(EARLY_HORIZONS,[5,15,30]);
});
test('research route cannot write, place trades, send notifications, or reveal ntfy topic',()=>{
 const path='../lib/early-study-route.mjs';
 const route=readFileSync(new URL(path,import.meta.url),'utf8');
 const core=readFileSync(new URL('../lib/early-study.mjs',import.meta.url),'utf8');
 const signals=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(signals,/mode==='early-study'/);
 assert.match(route,/NTFY_TOPIC/);
 assert.match(route,/source:'actual ntfy WEEX early alerts/);
 assert.match(route,/Object\.fromEntries\(Object\.entries\(study\)/);
 assert.doesNotMatch(route,/trade-confirm|placeOrder|@vercel\/blob|publishNtfy|\/capi\/v3\/order/);
 assert.doesNotMatch(core,/fetch\(|placeOrder|@vercel\/blob/);
});


test('V108 real ordinary PRE_BREAK format is parsed with published WEEX levels',()=>{
 const old=notify({kind:'PRE_BREAK'});
 const modern={...old,
  title:'🔮 ПРОГНОЗ · BTCUSDT SHORT · 🔵 ОБЫЧНЫЙ · 🟡 ЖДАТЬ',
  message:'👀 НАБЛЮДАЙ. НЕ ВХОДИТЬ.\n📉 Возможное ПАДЕНИЕ · WEEX\n'+
   'WEEX · 📍 Сейчас: 100 USDT\n'+
   '🔑 Подтверждение: ниже 99,5\n'+
   '❌ Отмена сценария: выше 101,25\n'+
   '⏳ Жди отдельного подтверждения 5М.'
 };
 const parsed=parseEarlyNotification(modern);
 assert.equal(parsed.watchType,'PRE_BREAK');
 assert.equal(parsed.direction,'SHORT');
 assert.equal(parsed.entry,100);
 assert.equal(parsed.trigger,99.5);
 assert.equal(parsed.invalidation,101.25);
 const previous=parseEarlyNotification(old);
 assert.equal(previous.watchType,'PRE_BREAK');
 assert.equal(previous.trigger,null);
 assert.equal(previous.invalidation,null);
 const wrong={...modern,message:modern.message.replace('ниже 99,5','выше 99,5')};
 const wrongParsed=parseEarlyNotification(wrong);
 assert.equal(wrongParsed.watchType,'PRE_BREAK');
 assert.equal(wrongParsed.trigger,null,'mismatched trigger direction cannot be reconstructed');
 assert.equal(wrongParsed.invalidation,null);
 const bybit={...modern,message:modern.message.replace('WEEX · 📍 Сейчас','Bybit · 📍 Сейчас')};
 assert.equal(parseEarlyNotification(bybit),null);
});
