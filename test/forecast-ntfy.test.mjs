import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {forecastTopic,forecastDue,forecastEligible,forecastMessage,
 forecastV2Line,runForecastNotifications} from '../lib/forecast-ntfy.mjs';
import {parsePublishedForecast} from '../lib/forecast-journal.mjs';

const now=Date.UTC(2026,10,10,10,0,30);
const topic='wr-'+('a'.repeat(32)),env={NTFY_TOPIC:topic};
function fixture(symbol='BTCUSDT',side='SHORT_BIAS',t=now){
 const s=side==='SHORT_BIAS'?40:61;
 const frames=[1,5,10].map((min,i)=>({
  intervalMinutes:min,closedAt:t-(i?300000:30000),
  direction:side,rsi14:s,relativeVolume:i?1.16:1.55,
  atr14:1.2,price:99.5,trend:side==='SHORT_BIAS'?'DOWN':'UP',
  voteAgreement:3,bollinger20:{position:'LOWER_HALF'}
 }));
 return {mode:'STANDALONE_WEEX_FORECAST_1_5_10',symbol,exchange:'WEEX',
  available:true,notTrade:true,ordersSent:0,signalPermission:false,
  alignment:'THREE_TIMEFRAME_ALIGNMENT',combinedDirection:side,timeframes:frames,
  primaryContext:{structure:'LOWER_HIGHS_LOW'}};
}
test('derived channel is private, stable and different from trading topic',()=>{
 const t=forecastTopic(env);
 assert.match(t,/^wr-[a-f0-9]{32}$/);
 assert.notEqual(t,topic);
 assert.equal(forecastTopic(env),t);
 assert.notEqual(forecastTopic({NTFY_TOPIC:'wr-'+('b'.repeat(32))}),t);
 assert.equal(forecastTopic({}),null);
 assert.equal(forecastDue(now),true);
 assert.equal(forecastDue(now+4*60_000),false);
});
test('only coherent fresh three-timeframe directional forecasts qualify',()=>{
 assert.equal(forecastEligible(fixture(),now),true);
 assert.equal(forecastEligible(fixture('XRPUSDT','LONG_BIAS'),now),true);
 assert.equal(forecastEligible({...fixture(),combinedDirection:'MIXED'},now),false);
 assert.equal(forecastEligible({...fixture(),signalPermission:true},now),false);
 assert.equal(forecastEligible({...fixture(),ordersSent:1},now),false);
 assert.equal(forecastEligible({...fixture(),exchange:'Bybit'},now),false);
 const tired=fixture();tired.timeframes[0].rsi14=20;
 assert.equal(forecastEligible(tired,now),false);
 const noVol=fixture();noVol.timeframes[0].relativeVolume=.4;
 assert.equal(forecastEligible(noVol,now),false);
 const stale=fixture();stale.timeframes[0].closedAt-=3*60_000;
 assert.equal(forecastEligible(stale,now),false);
});
test('notification clearly separates forecast hypothesis from LONG/SHORT entry',()=>{
 const m=forecastMessage(fixture());
 assert.match(m.title,/^🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · BTCUSDT 🟥 ⬇️ SHORT$/u);
 assert.match(m.message,/^👀 НАБЛЮДАЙ · НЕ ВХОДИ\./);
 assert.match(m.message,/1М \/ 5М \/ 10М/);
 assert.match(m.message,/НЕ сигнал входа/);
 assert.doesNotMatch(m.message,/Bollinger|EMA20|RSI14|Объём 1М/);
 assert.equal(m.priority,3);
 assert.equal(m.click,'https://weex-radar.vercel.app/forecast.html');
});
test('colored direction is easy to distinguish; historical title is still auditable',()=>{
 for(const [bias,mark,side] of [
  ['LONG_BIAS','🟩 ⬆️','LONG'],['SHORT_BIAS','🟥 ⬇️','SHORT']
 ]){
  const m=forecastMessage(fixture('XRPUSDT',bias));
  assert.ok(m.title.endsWith(mark+' '+side),'badge is next to direction');
  const original={event:'message',topic:forecastTopic(env),
   sequence_id:(side==='LONG'?'a':'b').repeat(32),
   time:Math.floor((now-1000)/1000),
   title:m.title,message:m.message};
  const parser=x=>parsePublishedForecast(x,forecastTopic(env),now);
  assert.equal(parser(original).direction,side,'new title recorded correctly');
  assert.equal(parser({...original,title:m.title.replace(mark+' ','')}).direction,
   side,'legacy titles still parsed');
  const mismatched=side==='LONG'?'🟥 ⬇️ LONG':'🟩 ⬆️ SHORT';
  assert.equal(parser({...original,title:m.title.replace(mark+' '+side,mismatched)}),
   null,'wrong color never misclassified');
  assert.ok(m.message.startsWith('👀 НАБЛЮДАЙ · НЕ ВХОДИ.'));
 }
});
test('plain-language forecast action keeps ntfy title, V2 and encrypted journal parser compatible',()=>{
 const f=fixture();
 const m=forecastMessage(f);
 assert.match(m.message,/^👀 НАБЛЮДАЙ · НЕ ВХОДИ\./u);
 assert.match(m.message,/📉 Возможное ПАДЕНИЕ/);
 assert.match(m.message,/⏳ Жди подтверждения 5М\./);
 assert.match(m.message,/Цена 1М: 99\.5000 USDT/);
 assert.match(m.message,/НЕ сигнал входа/);
 assert.doesNotMatch(m.message,/SL [0-9]|TP [0-9]|Прибыль \(TP\)/);
 assert.match(forecastMessage(fixture('XRPUSDT','LONG_BIAS')).message,
  /📈 Возможный РОСТ/);
 const record=(msg,id='a'.repeat(32))=>parsePublishedForecast({
  event:'message',topic:forecastTopic(env),
  sequence_id:id,time:Math.floor((now-1000)/1000),
  title:msg.title,message:msg.message
 },forecastTopic(env),now);
 const old=record(m);
 assert.equal(old.strength,'STANDARD');
 assert.equal(old.direction,'SHORT');
 assert.equal(old.reference,99.5);
 assert.equal(old.v2Timing,'UNKNOWN');
 f.strongV2Review={baselineLevel:'STRONG',sampleReady:true,
  status:'REVIEW_DOWNGRADE',proposedLevel:'STANDARD'};
 assert.equal(record(forecastMessage(f),'b'.repeat(32)).v2Timing,'LATE');
 f.strongV2Review.status='REVIEW_KEEP_STRONG';
 f.strongV2Review.proposedLevel='STRONG';
 assert.equal(record(forecastMessage(f),'c'.repeat(32)).v2Timing,'CLEAR');
 const risky=fixture();
 risky.timeframes[2].rsi14=25;
 const unsafe=forecastMessage(risky);
 assert.match(unsafe.title,/ПОВЫШЕННЫЙ РИСК/);
 assert.match(unsafe.message,/^👀 НАБЛЮДАЙ · НЕ ВХОДИ\./);
});

test('V2 timing line never turns observation into strong 5m confirmation',()=>{
 const strong=fixture();
 strong.strongV2Review={baselineLevel:'STRONG',sampleReady:true,
  status:'REVIEW_DOWNGRADE',proposedLevel:'STANDARD'};
 const late=forecastMessage(strong);
 assert.match(late.title,/^🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · BTCUSDT 🟥 ⬇️ SHORT$/u);
 assert.match(late.message,/V2: возможное опоздание/);
 assert.match(late.message,/НЕ сигнал входа/);
 assert.doesNotMatch(late.message,/SL \d|TP \d/);
 strong.strongV2Review.status='REVIEW_KEEP_STRONG';
 strong.strongV2Review.proposedLevel='STRONG';
 assert.match(forecastMessage(strong).message,/явных признаков опоздания не найдено \(не гарантия\)/);
 const standard=fixture();
 standard.timeframes[2].voteAgreement=2;
 standard.strongV2Review={baselineLevel:'STANDARD',sampleReady:true,
  status:'REVIEW_DOWNGRADE',proposedLevel:'CAUTION'};
 const message=forecastMessage(standard);
 assert.match(message.title,/🔵 ОБЫЧНЫЙ ПРОГНОЗ/);
 assert.match(message.message,/V2: возможное опоздание/);
 standard.strongV2Review.status='REVIEW_KEEP_STANDARD';
 standard.strongV2Review.proposedLevel='STANDARD';
 assert.match(forecastMessage(standard).message,/явных признаков опоздания не найдено/);
 standard.strongV2Review.sampleReady=false;
 assert.match(forecastMessage(standard).message,/недостаточно данных/);
 standard.strongV2Review.sampleReady=true;
 standard.strongV2Review.baselineLevel='STRONG';
 assert.match(forecastMessage(standard).message,/недостаточно данных/);
 assert.equal(forecastV2Line(fixture(), 'CAUTION'),'');
 const caution=fixture();
 caution.timeframes[2].rsi14=25;
 caution.strongV2Review={baselineLevel:'CAUTION',status:'REVIEW_DOWNGRADE',sampleReady:true,proposedLevel:'STANDARD'};
 assert.match(forecastMessage(caution).title,/ПОВЫШЕННЫЙ РИСК/);
 assert.doesNotMatch(forecastMessage(caution).message,/🧪 V2/);
});

test('both forecast directions and cautious warnings are concise and stay journal-compatible',()=>{
 for(const side of ['LONG_BIAS','SHORT_BIAS']){
  const d=fixture('XRPUSDT',side);
  const m=forecastMessage(d);
  assert.ok(m.message.split('\n').length<=7,'forecast text is short');
  assert.match(m.message,/НЕ сигнал входа/);
  assert.match(m.message,/Цена 1М: \d+\.\d+ USDT/);
  assert.match(m.title,/^🔮 /);
  assert.match(m.message,/1М \/ 5М \/ 10М/);
  assert.doesNotMatch(m.message,/ЧТО ДЕЛАТЬ|RSI14|Bollinger/);
  const record=parsePublishedForecast({
   event:'message',topic:forecastTopic(env),time:Math.floor((now-1000)/1000),
   sequence_id:(side==='LONG_BIAS'?'d':'e').repeat(32),
   title:m.title,message:m.message
  },forecastTopic(env),now);
  assert.ok(record,'journal can still parse shortened forecast');
  assert.equal(record.direction,side==='LONG_BIAS'?'LONG':'SHORT');
 }
 const risky=fixture();
 risky.timeframes[2].rsi14=25;
 const msg=forecastMessage(risky);
 assert.match(msg.title,/ПОВЫШЕННЫЙ РИСК/);
 assert.match(msg.message,/НЕ ВХОДИ/);
 assert.ok(msg.message.split('\n').length<=6);
});

test('owner gets one onboarding message in old topic; forecasts go ONLY to derived topic, capped at 2',async()=>{
 const events=[];
 const fetchImpl=async url=>({
  ok:true,text:async()=>'',headers:{get:()=>null}
 });
 const publish=async(topic,message)=>{events.push({topic,...message});return true};
 const symbols=['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT'];
 const reader=async symbol=>fixture(symbol,'SHORT_BIAS',now);
 const first=await runForecastNotifications({env,now,clock:()=>now,fetchImpl,publish,reader,symbols});
 assert.equal(first.configured,true);
 assert.equal(first.due,true);
 assert.equal(first.scanned,4);
 assert.equal(first.aligned,4);
 assert.equal(first.eligible,4);
 assert.equal(first.delivered,2);
 assert.equal(first.setupSent,1);
 const configs=events.filter(x=>x.topic===topic);
 const forecasts=events.filter(x=>x.topic===forecastTopic(env));
 assert.equal(configs.length,1);
 assert.equal(forecasts.length,2);
 assert.ok(configs[0].click.startsWith('ntfy://ntfy.sh/'));
 assert.match(configs[0].message,/отдельные прогнозы/);
 assert.ok(forecasts.every(x=>x.title.startsWith('🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ')&&
  /НЕ сигнал входа/.test(x.message)));
 assert.ok(events.every(x=>!x.message.includes('API_SECRET')));
 const nextHistory=async url=>{
  const target=url.includes(encodeURIComponent(forecastTopic(env)))?forecastTopic(env):topic;
  const recorded=events.filter(e=>e.topic===target).map(e=>JSON.stringify({
   event:'message',topic:target,sequence_id:e.sequenceId,time:Math.floor(now/1000),
   title:e.title,message:e.message
  })).join('\n');
  return {ok:true,text:async()=>recorded};
 };
 const second=await runForecastNotifications({
  env,now:now+1000,clock:()=>now+1000,fetchImpl:nextHistory,publish,reader,symbols
 });
 assert.equal(second.delivered,0);
 assert.equal(second.setupSent,0);
 assert.equal(events.length,3);
});
test('missing ntfy history fails closed without flooding forecast topic',async()=>{
 const messages=[];
 const r=await runForecastNotifications({
  env,now,fetchImpl:async()=>{throw Error('No recent history')},
  publish:async(topic,message)=>{messages.push([topic,message]);return true},
  reader:async symbol=>fixture(symbol)
 });
 assert.equal(r.delivered,0);
 assert.equal(r.failed,1);
 assert.equal(messages.length,0);
});
test('not due, or unset topic, does not scan WEEX or publish',async()=>{
 for(const [cfg,t] of [[env,now+4*60_000],[{},now]]){
  const r=await runForecastNotifications({env:cfg,now:t,
   reader:async()=>{throw Error('MUST_NOT_SCAN')},
   publish:async()=>{throw Error('MUST_NOT_PUBLISH')}
  });
  assert.equal(r.scanned,0);
  assert.equal(r.delivered,0);
 }
});
test('main LONG/SHORT push, forecast topic and health are separated and do not place orders',()=>{
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const health=readFileSync(new URL('../lib/health-route.mjs',import.meta.url),'utf8');
 const source=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 assert.match(dispatch,/ntfySend\('confirmed',signals\)/);
 assert.match(dispatch,/await runForecastNotifications\(\)/);
 assert.match(dispatch,/independentForecast/);
 assert.match(health,/forecastNotifications:/);
 assert.match(health,/phoneSubscriptionVerified:false/);
 assert.match(source,/MAX_PER_BUCKET=2/);
 assert.match(source,/forecastTopic\(env\)/);
 assert.match(page,/id="subscribe-forecast"/);
 assert.match(page,/ntfy:\/\/ntfy.sh\//);
 const match=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match);
 assert.doesNotThrow(()=>new Script(match[1]));
 for(const bad of [/placeOrder\(/,/trade-confirm/,/trade-prepare/,/capi\/v3\/order/,/WEEX_API_SECRET/]){
  assert.doesNotMatch(source,bad);
 }
});

test('new square arrows preserve historical forecast journal identity and reject wrong side',()=>{
 const f=fixture('BTCUSDT','SHORT_BIAS');
 const data=forecastMessage(f),t=forecastTopic(env),timestamp=Math.floor((now-1000)/1000);
 const input={event:'message',topic:t,time:timestamp,sequence_id:'f'.repeat(32),
  title:data.title,message:data.message};
 const current=parsePublishedForecast(input,t,now);
 const old=parsePublishedForecast({...input,title:'🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · BTCUSDT 🔴 SHORT'},t,now);
 const plain=parsePublishedForecast({...input,title:'🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · BTCUSDT SHORT'},t,now);
 for(const sample of [current,old,plain]){
  assert.ok(sample);
  assert.equal(sample.symbol,'BTCUSDT');
  assert.equal(sample.direction,'SHORT');
  assert.equal(sample.reference,99.5);
  assert.equal(sample.strength,'STANDARD');
 }
 assert.equal(parsePublishedForecast({...input,
  title:data.title.replace('🟥 ⬇️ SHORT','🟩 ⬆️ SHORT')},t,now),null);
});

test('owner receives ONE tap-to-subscribe FOLLOW invite in existing ntfy, without manual topic entry',async()=>{
 const t=Date.UTC(2026,10,16,17,50,30);
 const cfg={NTFY_TOPIC:'wr-'+('c'.repeat(32)),VERCEL_ENV:'production'};
 const events=[];
 const fetcher=async url=>{
  const parsed=new URL(url),topic=decodeURIComponent(parsed.pathname.slice(1));
  const rows=events.filter(e=>e.topic===topic).map(e=>JSON.stringify({
   event:'message',topic,sequence_id:e.sequenceId,time:Math.floor(t/1000)
  })).join('\\n');
  return {ok:true,status:200,text:async()=>rows};
 };
 const publisher=async(topic,notice)=>{events.push({topic,...notice});return true};
 const run=at=>runForecastNotifications({
  now:at,clock:()=>at,env:cfg,symbols:[],fetchImpl:fetcher,
  publish:publisher,reader:async()=>{throw Error('MUST_NOT_SCAN')}
 });
 const first=await run(t);
 assert.equal(first.due,true);
 assert.equal(first.followerSetupSent,1);
 assert.equal(first.delivered,0);
 assert.equal(first.scanned,0);
 assert.equal(events.length,1);
 assert.equal(events[0].topic,cfg.NTFY_TOPIC);
 assert.match(events[0].title,/WEEX FOLLOW.*ПОДКЛЮЧИТЬ/);
 assert.match(events[0].message,/подписку WEEX FOLLOW/);
 assert.match(events[0].message,/НЕ сигнал входа/);
 assert.match(events[0].click,/^ntfy:\/\/ntfy\.sh\/wr-[a-f0-9]{32}\?display=WEEX\+FOLLOW$/);
 assert.notEqual(events[0].click,'ntfy://ntfy.sh/'+cfg.NTFY_TOPIC);
 assert.equal(events[0].message.includes(cfg.NTFY_TOPIC),false);
 const again=await run(t+10*60_000);
 assert.equal(again.followerSetupSent,0);
 assert.equal(events.length,1);
});
test('FOLLOW onboarding has no effect in preview, outside release window or when history is down',async()=>{
 const t=Date.UTC(2026,10,16,17,50,30),envProd={
  NTFY_TOPIC:'wr-'+('d'.repeat(32)),VERCEL_ENV:'production'
 };
 const events=[];
 const publish=async(topic,notice)=>{events.push({topic,notice})};
 const run=(at,env,fetchImpl)=>runForecastNotifications({
  now:at,clock:()=>at,env,symbols:[],fetchImpl,publish
 });
 const empty=async()=>({ok:true,text:async()=>''});
 const preview=await run(t,{...envProd,VERCEL_ENV:'preview'},empty);
 assert.equal(preview.followerSetupSent,0);
 const expired=await run(Date.UTC(2026,10,17,9,10,30),envProd,empty);
 assert.equal(expired.followerSetupSent,0);
 const offline=await run(t,envProd,async()=>{throw Error('ntfy offline')});
 assert.equal(offline.followerSetupSent,0);
 assert.equal(offline.delivered,0);
 assert.equal(events.length,0);
});
