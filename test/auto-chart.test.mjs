import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import { _test as early } from '../lib/early-watch.mjs';
const html=readFileSync(new URL('../tradingview.html',import.meta.url),'utf8');
const moduleCode=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
test('EMA20 and EMA50 plot data use closed WEEX candles only',()=>{
 const candles=Array.from({length:125},(_,i)=>({
   time:i*60000,closeTime:(i+1)*60000,open:100+i,high:101+i,low:99+i,close:100+i,volume:100
 }));
 const data=early.chartCandles(candles);
 assert.equal(data.length,75);
 assert.equal(data[0].time,candles[50].closeTime);
 assert.ok(data.every(x=>Number.isFinite(x.ema20)&&Number.isFinite(x.ema50)));
 assert.equal(data.at(-1).ema20<125+100,true);
 assert.equal(early.emaSeries(candles.slice(0,10),20).filter(x=>x!==null).length,0);
});
test('chart view is browser-only, no TradingView login, trading orders or cron change',()=>{
 assert.match(moduleCode,/req\.query\?\.chart==='1'/);
 assert.match(html,/id="radar-canvas"/);
 assert.match(html,/function renderRadarChart\(rows,watch\)/);
 assert.match(html,/mode=early&chart=1&symbol=/);
 assert.match(html,/Pine Editor/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
});
