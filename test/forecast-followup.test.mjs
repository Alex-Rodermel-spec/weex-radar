import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 parseForecastMessage,followupSequence,normalizeFollowupCandles,
 evaluateForecast,forecastFollowupMessage
} from '../lib/forecast-followup.mjs';
import {followupSentForecasts} from '../lib/ntfy-alerts.mjs';

const M=60_000,base=Date.UTC(2026,10,9,12,0,0);
const now=base+4*M+40_000,topic='wr-'+'a'.repeat(32),sequence='a'.repeat(32);
const record=(dir='SHORT',changes={})=>({
 event:'message',topic,time:Math.floor((base+27_000)/1000),
 sequence_id:sequence,
 title:'🔮 ПРОГНОЗ · XRPUSDT '+dir+' · 🟡 ЖДАТЬ',
 message:(dir==='SHORT'?'📉':'📈')+' Возможное движение в ближайшие 5 мин\n'+
 'WEEX · 📍 Сейчас: 100 USDT\n'+
 '🔑 Подтверждение: '+(dir==='SHORT'?'ниже 99,5':'выше 100,5')+'\n'+
 '❌ Отмена сценария: '+(dir==='SHORT'?'выше 101,5':'ниже 98,5'),
 ...changes
});
const marketBar=(minute,open,high,low,close)=>[
 base+minute*M,String(open),String(high),String(low),String(close),'100'
];
const bars=[
 marketBar(1,100,100.7,99.7,100.1),
 marketBar(2,100.1,100.2,99.1,99.2),
 marketBar(3,99.2,99.5,98.8,99.0)
];
const norm=rows=>normalizeFollowupCandles(rows,now);
const sample=()=>parseForecastMessage(record(),now);

test('parse only original, dedupable, recent WEEX PRE_BREAK forecast with correct levels',()=>{
 const f=sample();
 assert.ok(f);
 assert.equal(f.symbol,'XRPUSDT');
 assert.equal(f.direction,'SHORT');
 assert.equal(f.trigger,99.5);
 assert.equal(f.invalidation,101.5);
 assert.equal(f.horizonEndsAt-f.sentAt,5*M);
 assert.match(followupSequence(f),/^[a-f0-9]{32}$/);
 assert.equal(parseForecastMessage(record('LONG'),now).direction,'LONG');
 for(const bad of [
  {title:'🟡 ЖДАТЬ · XRPUSDT SHORT · ⚡ EARLY WATCH'},
  {message:'неизвестный прогноз'},
  {sequence_id:'WRONG'},
  {event:'open'},
  {message:record().message.replace('WEEX','Bybit')},
  {message:record().message.replace('ниже 99,5','выше 99,5')}
 ])assert.equal(parseForecastMessage(record('SHORT',bad),now),null);
 assert.equal(parseForecastMessage(record('SHORT',{time:Math.floor((now-8*M)/1000)}),now),null);
});

test('only completed candles STRICTLY AFTER the notification can confirm SHORT and LONG',()=>{
 const short=sample();
 const early=norm([marketBar(0,100,105,97,98),bars[0]]);
 assert.equal(evaluateForecast(short,early,now).status,'PENDING',
  'earlier candles cannot confirm a prediction sent later');
 const confirmed=evaluateForecast(short,norm(bars),now);
 assert.equal(confirmed.status,'BREAKOUT');
 assert.equal(confirmed.at,base+3*M);
 const long=parseForecastMessage(record('LONG'),now);
 assert.equal(evaluateForecast(long,norm([
  marketBar(1,100,100.4,99.5,100.2),
  marketBar(2,100.2,101.2,100.1,100.8)
 ]),now).status,'BREAKOUT');
});

test('invalidation takes precedence, and intrabar conflict is never an accepted breakout',()=>{
 const s=sample();
 assert.equal(evaluateForecast(s,norm([
  marketBar(1,100,101.8,99.7,100.5),
  bars[1]
 ]),now).status,'INVALIDATED');
 assert.equal(evaluateForecast(s,norm([
  marketBar(1,100,102,98,99.0)
 ]),now).status,'AMBIGUOUS');
 assert.equal(evaluateForecast(s,norm([
  marketBar(2,100,100.5,99.1,99.2)
 ]),now).status,'NO_DATA');
});

test('expiry is observed only after completed window, not guessed intrabar',()=>{
 const s=sample();
 const neutral=[1,2,3,4].map(m=>marketBar(m,100,100.5,99.7,100.0));
 assert.equal(evaluateForecast(s,normalizeFollowupCandles(neutral,base+5*M+10_000),
  base+5*M+10_000).status,'PENDING');
 assert.equal(evaluateForecast(s,normalizeFollowupCandles(neutral,base+6*M+40_000),
  base+6*M+40_000).status,'EXPIRED');
});

test('a broken outcome cannot be green; review requires actual same-market 5m approval',()=>{
 const s=sample(),r={status:'BREAKOUT',at:base+3*M};
 assert.match(forecastFollowupMessage(s,r,null,now).title,/ЖДАТЬ 5М/);
 const matching={symbol:'XRPUSDT',status:'ok',exchange:'WEEX',
  direction:'SHORT',candleCloseTime:base+3*M,expiresAt:now+120_000,livePrice:99.1,stop:101,take:95,
  advisor:{status:'REVIEW',netRR:1.7}};
 const green=forecastFollowupMessage(s,r,matching,now);
 assert.equal(green.decision,'REVIEW');
 assert.match(green.title,/ПРОВЕРИТЬ ВХОД/);
 assert.match(green.message,/Перепроверь цену/);
 assert.equal(forecastFollowupMessage(s,r,{...matching,direction:'LONG'},now).decision,'WAIT');
 assert.equal(forecastFollowupMessage(s,r,{...matching,candleCloseTime:base-5*M},now).decision,'WAIT');
 assert.equal(forecastFollowupMessage(s,r,{...matching,expiresAt:now+5_000},now).decision,'WAIT');
 assert.equal(forecastFollowupMessage(s,r,{...matching,advisor:{status:'SKIP',netRR:1.1}},now).decision,'WAIT');
 for(const status of ['INVALIDATED','AMBIGUOUS','EXPIRED']){
  assert.equal(forecastFollowupMessage(s,{status,at:base+3*M},matching,now).decision,'SKIP');
 }
});

test('ntfy followup is sent only once, reuses same topic, then counts as duplicate',async()=>{
 const sent=[],stored=[record()];
 const fetchImpl=async(url)=>{
  if(String(url).includes('ntfy.sh'))return {
   ok:true,text:async()=>stored.map(x=>JSON.stringify(x)).join('\n')
  };
  assert.match(url,/interval=1m&limit=25/);
  return {ok:true,json:async()=>bars};
 };
 const publish=async(_topic,payload)=>{
  assert.equal(_topic,topic);
  assert.match(payload.title,/ПРОБОЙ/);
  sent.push(payload);
  stored.push({event:'message',topic,sequence_id:payload.sequenceId,
   title:payload.title,message:payload.message,time:Math.floor(now/1000)});
  return true;
 };
 const first=await followupSentForecasts({now,topic,fetchImpl,publish,markets:[]});
 assert.equal(first.checked,1);
 assert.equal(first.sent,1);
 assert.equal(first.failed,0);
 assert.equal(sent.length,1);
 const again=await followupSentForecasts({now:now+2_000,topic,fetchImpl,publish});
 assert.equal(again.duplicates,1);
 assert.equal(again.sent,0);
 assert.equal(sent.length,1);
});

test('forecast follow-up cannot write orders, loosen filters, modify journal or pay for services',()=>{
 const core=readFileSync(new URL('../lib/forecast-followup.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(dispatch,/followupSentForecasts\(/);
 assert.match(dispatch,/const forecastFollowup=\{enabled:false/);
 assert.match(dispatch,/ntfySend\('confirmed',signals\)/);
 assert.match(dispatch,/const earlyPromise=safeEarlyPush\(\)/);
 assert.match(ntfy,/followupSequence\(forecast\)/);
 for(const forbidden of [/\/trade-confirm/,/\/trade-prepare/,/@vercel\/blob/,/WEEX_API_SECRET/,/placeOrder\(/]){
  assert.doesNotMatch(core,forbidden);
 }
});
