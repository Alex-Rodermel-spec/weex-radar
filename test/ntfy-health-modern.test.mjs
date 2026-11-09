import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {classifyMarketNtfyTitle,summarizeMarketNtfyHistory,
 ntfyGatewayHealth} from '../lib/health-monitor.mjs';

const now=Date.UTC(2026,10,9,1,30,0),topic='wr-'+'a'.repeat(32);
const mk=(title,minutesAgo,id)=>({event:'message',topic,title,
 time:Math.floor((now-minutesAgo*60000)/1000),
 ...(id?{sequence_id:id}:{})});
const early='🟡 ЖДАТЬ · XRPUSDT SHORT · ⚡ EARLY WATCH';
const forecast='🔮 ПРОГНОЗ · HYPEUSDT LONG · 🟡 ЖДАТЬ';
const confirmed='🟡 ЖДАТЬ · HYPEUSDT SHORT · 🔔 ОБЫЧНЫЙ';
const strong='🟢 ПРОВЕРИТЬ · BTCUSDT LONG · 🟣 СИЛЬНЫЙ';
const skipped='🔴 ПРОПУСТИТЬ · ETHUSDT SHORT · 🔔 ОБЫЧНЫЙ';

test('classifies both historical and current ntfy formats without confusing forecasts and confirmations',()=>{
 for(const title of [confirmed,strong,skipped,'🟢 ВХОД LONG · BTCUSDT','🔔 ОБЫЧНЫЙ ALGOUSDT SHORT',
  '🟣 СИЛЬНЫЙ XRPUSDT LONG'])assert.equal(classifyMarketNtfyTitle(title),'confirmed');
 for(const title of [early,forecast,'🔮 ПРОГНОЗ РОСТА · ZECUSDT','⚡ EARLY WATCH ZECUSDT SHORT'])
  assert.equal(classifyMarketNtfyTitle(title),'early');
 for(const title of [undefined,'','🚨 WEEX RADAR · CRON НЕ ОТВЕЧАЕТ',
  '🟡 ЖДАТЬ · HYPEUSDT SHORT · 🟣 СИЛЬНЫЙ additional text',
  '🟡 ЖДАТЬ · ../../etc SHORT · 🔔 ОБЫЧНЫЙ'])
  assert.equal(classifyMarketNtfyTitle(title),null);
});

test('two-hour ntfy history counts signals, not cron alerts, and dedupes stable IDs',()=>{
 const id='c'.repeat(32);
 const rows=[
  mk(early,5,id),
  mk(early,4,id), // Duplicate retry from primary/backup.
  mk(forecast,3),
  mk(confirmed,2),
  mk(strong,1),
  mk('⚡ EARLY WATCH ZECUSDT SHORT',119),
  mk(skipped,121), // Too old.
  mk('🚨 WEEX RADAR · CRON НЕ ОТВЕЧАЕТ',0),
  {...mk(skipped,0),event:'open'},
  {...mk(skipped,-2),time:Math.floor((now+20000)/1000)}
 ];
 const summary=summarizeMarketNtfyHistory(rows,now);
 assert.deepEqual(summary.recentTwoHours,{total:5,early:3,confirmed:2});
 assert.equal(summary.lastSignalAt,now-60000);
 assert.equal(summary.lastEarlySignalAt,now-3*60000);
 assert.equal(summary.lastConfirmedSignalAt,now-60000);
 assert.deepEqual(summarizeMarketNtfyHistory([],now).recentTwoHours,
  {total:0,early:0,confirmed:0});
});

test('gateway health uses current alert titles and does not claim Android delivery',async()=>{
 const rows=[mk(early,5),mk(confirmed,1)];
 const calls=[];
 const mock=async(url,options)=>{
  calls.push({url,options});
  return {ok:true,text:async()=>rows.map(x=>JSON.stringify(x)).join('\n')};
 };
 const out=await ntfyGatewayHealth(mock,{NTFY_TOPIC:topic},now);
 assert.equal(out.configured,true);
 assert.equal(out.reachable,true);
 assert.equal(out.lastSignalAt,now-60000);
 assert.deepEqual(out.recentTwoHours,{total:2,early:1,confirmed:1});
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/json\?poll=1&since=2h/);
 assert.ok(!Object.hasOwn(out,'topic'));
 const failed=await ntfyGatewayHealth(async()=>{throw Error('offline')},
  {NTFY_TOPIC:topic},now);
 assert.equal(failed.reachable,false);
 assert.equal(failed.lastSignalAt,null);
 assert.equal(failed.recentTwoHours.total,0);
});

test('health UI displays observed counts and does not change alerts or orders',()=>{
 const ui=readFileSync(new URL('../health.html',import.meta.url),'utf8');
 const radar=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const monitor=readFileSync(new URL('../lib/health-monitor.mjs',import.meta.url),'utf8');
 assert.match(ui,/ntfy\.recentTwoHours/);
 assert.match(ui,/обычных 5м/);
 const script=ui.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 assert.match(radar,/mode==='health'/);
 assert.doesNotMatch(monitor,/trade-confirm|placeOrder|\/capi\/v3\/order/);
});
