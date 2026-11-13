import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseStandaloneNtfyMessage,summarizeStandaloneForecastNotices,
 STANDALONE_FORECAST_AUDIT} from '../lib/v110-standalone-forecast-audit.mjs';
const MIN=60_000,T=Date.UTC(2026,10,12,21,0),TOPIC='wr-'+('b'.repeat(32));
function ntfy(patch={}){
 return {event:'message',topic:TOPIC,time:Math.floor((T+18000)/1000),
  sequence_id:'c'.repeat(32),
  title:'🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · TRXUSDT SHORT',
  message:'👀 НАБЛЮДАЙ. НЕ ВХОДИ.\n📉 Возможное ПАДЕНИЕ · WEEX\n'+
   'Цена 1М: 0.315510 USDT · свеча 22:00\n'+
   '📊 Направление 1М / 5М / 10М совпало.\n'+
   '🧪 V2: явных признаков опоздания не найдено (не гарантия)\n'+
   '⏳ Жди подтверждения. НЕ сигнал входа, не гарантия.',
  ...patch};
}
function minute(){
 const rows=Array.from({length:25},(_,i)=>({
  time:T+i*MIN,closeTime:T+(i+1)*MIN,
  open:.31551,high:.31556,low:.31542,close:.31551
 }));
 // Scoring starts at 22:01, excluding the partial 22:00 alert minute.
 for(let i=1;i<=5;i++)rows[i].close=.31549;
 for(let i=6;i<=10;i++)rows[i].close=.31545;
 for(let i=11;i<=15;i++)rows[i].close=.31558;
 return rows.map(r=>({...r,high:Math.max(r.high,r.open,r.close),
  low:Math.min(r.low,r.open,r.close)}));
}
test('real screenshot-format ordinary TRX forecast recognized with actual relay time',()=>{
 const p=parseStandaloneNtfyMessage(ntfy(),TOPIC);
 assert.equal(p.symbol,'TRXUSDT');
 assert.equal(p.direction,'SHORT');
 assert.equal(p.level,'ORDINARY');
 assert.equal(p.entry,.315510);
 assert.equal(p.sentAt,T+18000);
 assert.equal(p.group,'ALT_CRYPTO');
 assert.equal(p.key,'c'.repeat(32));
 assert.equal(STANDALONE_FORECAST_AUDIT.hasBreakoutTrigger,false);
 assert.equal(STANDALONE_FORECAST_AUDIT.canPromoteToStrong,false);
});
test('only the correct channel and actual WEEX notification qualify',()=>{
 for(const patch of [
  {topic:'wrong'},
  {title:'🔮 ПРОГНОЗ · TRXUSDT SHORT · 🔵 ОБЫЧНЫЙ · 🟡 ЖДАТЬ'},
  {title:'🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · INVALIDUSDT SHORT'},
  {message:ntfy().message.replace('WEEX','Bybit')},
  {message:ntfy().message.replace('0.315510','0')},
  {time:'22:00'},
  {event:'open'}
 ]){
  assert.equal(parseStandaloneNtfyMessage(ntfy(patch),TOPIC),null);
 }
 const caution=parseStandaloneNtfyMessage(ntfy({
  title:'🔮 🟡 ПОВЫШЕННЫЙ РИСК · KOUSDT SHORT'
 }),TOPIC);
 assert.equal(caution.level,'ELEVATED_RISK');
});
test('TRX SHORT 5m and 10m initially favorable but 15m reversed; no execution',()=>{
 const alert=parseStandaloneNtfyMessage(ntfy(),TOPIC);
 const data=summarizeStandaloneForecastNotices([alert],
  new Map([['TRXUSDT',minute()]]),T+25*MIN);
 assert.equal(data.mode,'ACTUAL_SEPARATE_NTFY_FORECAST_AUDIT');
 assert.equal(data.overall.total,1);
 assert.equal(data.overall.horizons[5].favorable,1);
 assert.equal(data.overall.horizons[10].favorable,1);
 assert.equal(data.overall.horizons[15].adverse,1);
 assert.equal(data.overall.continuationAfter5m.observed,1);
 assert.equal(data.overall.continuationAfter5m.favorableAt5mAnd10m,1);
 assert.equal(data.byLabel.ORDINARY.total,1);
 assert.equal(data.byMarketGroup.ALT_CRYPTO.total,1);
 assert.equal(data.noAutotrading,true);
 assert.equal(data.notificationsSent,0);
});
test('no notifications or incomplete future candles do not fabricate win rate',()=>{
 const alert=parseStandaloneNtfyMessage(ntfy(),TOPIC);
 const empty=summarizeStandaloneForecastNotices([],
  new Map(),T+18*MIN);
 assert.equal(empty.overall.total,0);
 assert.equal(empty.overall.horizons[5].favorablePct,null);
 const noData=summarizeStandaloneForecastNotices([alert,alert],
  new Map(),T+25*MIN);
 assert.equal(noData.overall.total,1);
 assert.equal(noData.overall.horizons[5].noData,1);
 const pending=summarizeStandaloneForecastNotices([alert],
  new Map([['TRXUSDT',minute()]]),T+5*MIN);
 assert.equal(pending.overall.horizons[5].pending,1);
 assert.equal(pending.overall.horizons[5].observed,0);
});
test('manual audit is aggregate-only, separate from any trade/ntfy dispatch',()=>{
 const module=readFileSync(new URL('../lib/v110-standalone-forecast-audit.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/early-study-route.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(route,/actualStandaloneForecastStudy/);
 assert.match(route,/maxPublicWeexRequests:8/);
 assert.match(route,/standaloneForecast:/);
 assert.doesNotMatch(module,/ntfySend|placeOrder|trade-confirm|publishNtfy|\/capi\/v3\/order|fetch\(/);
 assert.doesNotMatch(dispatch,/actualStandaloneForecastStudy|standaloneForecast:standaloneForecast/);
});
