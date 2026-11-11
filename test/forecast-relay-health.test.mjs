import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {forecastTopic} from '../lib/forecast-ntfy.mjs';
import {summarizeForecastNtfyHistory,forecastGatewayHealth}
 from '../lib/health-monitor.mjs';

const MIN=60_000,now=Date.parse('2026-11-11T16:00:00Z');
const topic=forecastTopic({NTFY_TOPIC:'wr-'+'a'.repeat(32)});
const make=(title,at,sequence_id)=>({
 event:'message',topic,title,time:Math.floor(at/1000),sequence_id
});
const strong='🔮 🟣 СИЛЬНЫЙ ПРОГНОЗ · BTCUSDT LONG';
const standard='🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · ETHUSDT SHORT';
const caution='🔮 🟡 ПОВЫШЕННЫЙ РИСК · ZECUSDT SHORT';
test('forecast notifications use only a derived separate topic and strict sent titles',()=>{
 const rows=[
  make(strong,now-MIN,'a'.repeat(32)),
  make(strong,now-MIN,'a'.repeat(32)), // duplicate
  make(standard,now-20*MIN,'b'.repeat(32)),
  make(caution,now-119*MIN,'c'.repeat(32)),
  make(strong,now-121*MIN,'d'.repeat(32)), // outside 2h
  make('🟢 ПРОВЕРИТЬ · BTCUSDT LONG · 🔔 ОБЫЧНЫЙ',now-MIN,'e'.repeat(32)),
  make('🔮 WEEX RADAR · ПОДКЛЮЧИТЬ ПРОГНОЗЫ',now-MIN,'f'.repeat(32)),
  make('🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · ETHUSDT SHORT',now+6000,'g'.repeat(32)),
 ];
 const sum=summarizeForecastNtfyHistory(rows,now);
 assert.equal(sum.recentTwoHours.total,3);
 assert.equal(sum.recentTwoHours.STRONG,1);
 assert.equal(sum.recentTwoHours.STANDARD,1);
 assert.equal(sum.recentTwoHours.CAUTION,1);
 assert.equal(sum.lastForecastAt,now-MIN);
 assert.doesNotMatch(JSON.stringify(sum),/wr-[a-f0-9]{32}/);
});
test('relay connected only means ntfy server accepted forecasts, NOT Android delivery',async()=>{
 assert.match(topic,/^wr-[a-f0-9]{32}$/);
 const sent=[make(strong,now-90*MIN,'1'.repeat(32)),
  make(standard,now-5*MIN,'2'.repeat(32))];
 let calls=0;
 const mock=async(url,opts)=>{
  calls++;
  assert.match(url,/json\?poll=1&since=2h$/);
  assert.ok(url.includes(topic));
  assert.equal(opts.cache,'no-store');
  return {ok:true,text:async()=>sent.map(x=>JSON.stringify(x)).join('\n')};
 };
 const result=await forecastGatewayHealth(topic,mock,now);
 assert.equal(calls,1);
 assert.deepEqual(result,{
  configured:true,reachable:true,lastForecastAt:now-5*MIN,
  recentTwoHours:{total:2,STRONG:1,STANDARD:1,CAUTION:0},
  deliveryToPhoneVerified:false
 });
 assert.equal((await forecastGatewayHealth(null,mock,now)).configured,false);
 assert.equal(calls,1);
 assert.equal((await forecastGatewayHealth(topic,async()=>{throw Error('offline')},now)).reachable,false);
 const junk=await forecastGatewayHealth(topic,async()=>({ok:true,text:async()=>''}),now);
 assert.equal(junk.reachable,true);
 assert.equal(junk.recentTwoHours.total,0);
});
test('health endpoint and page show forecast channel independently; no secret or trade endpoints',()=>{
 const route=readFileSync(new URL('../lib/health-route.mjs',import.meta.url),'utf8');
 const monitor=readFileSync(new URL('../lib/health-monitor.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../health.html',import.meta.url),'utf8');
 assert.match(route,/forecastGatewayHealth\(forecastTopic\(\)\)/);
 assert.match(route,/gatewayReachable:forecastNtfy\.reachable/);
 assert.match(route,/lastForecastAt:forecastNtfy\.lastForecastAt/);
 assert.match(route,/phoneSubscriptionVerified:false/);
 assert.match(route,/deliveryToPhoneVerified:false/);
 assert.match(page,/id="forecast-card"/);
 assert.match(page,/lastForecastAt/);
 assert.match(page,/Торговый канал: подтверждённые LONG \/ SHORT/);
 assert.doesNotMatch(page,/Прогнозы — без уведомлений/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'health.html'}));
 for(const s of [route,monitor,page])
  assert.doesNotMatch(s,/\/api\/trade-confirm|\/api\/trade-prepare|WEEX_API_SECRET/);
});
