import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {_test as markets} from '../api/signals.mjs';
import {forecastEligible} from '../lib/forecast-ntfy.mjs';

const original=[
 'BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','ALGOUSDT','1000SHIBUSDT',
 'DOGEUSDT','XAUTUSDT','ZECUSDT','1000PEPEUSDT','HYPEUSDT',
 'BNBUSDT','ADAUSDT','LINKUSDT','SUIUSDT','AVAXUSDT'
];
const added=[
 'TRXUSDT','XAUUSDT','XAGUSDT','AUDUSDT','CADUSDT','JPYUSDT',
 'GBPUSDT','CHFUSDT','EURUSDT','GOOGLUSDT','MRNAUSDT',
 'NVDAUSDT','AMDUSDT','MSFTUSDT','CSCOUSDT','KOUSDT'
];

test('all 32 are confirmed-monitor markets; only original 16 retain manual order permission',()=>{
 assert.deepEqual(markets.TRADE_SYMBOLS,original);
 assert.equal(markets.TRADE_SYMBOLS.length,16);
 assert.deepEqual(markets.SYMBOLS,[...original,...added]);
 assert.deepEqual(markets.FORECAST_SYMBOLS,[...original,...added]);
 assert.equal(new Set(markets.SYMBOLS).size,32);
 for(const symbol of added){
  assert.ok(markets.SYMBOLS.includes(symbol));
  assert.ok(!markets.TRADE_SYMBOLS.includes(symbol));
 }
 const api=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(api,/return handleStandaloneForecast\(req,res,FORECAST_SYMBOLS\)/);
 assert.match(api,/Math\.min\(4,SYMBOLS\.length\)/);
});

test('forecast dashboard and server use same 32 contract symbols',()=>{
 const page=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 const found=page.match(/const SYMBOLS=\[([\s\S]*?)\];/);
 assert.ok(found);
 const displayed=[...found[1].matchAll(/'([0-9A-Z]+USDT)'/g)].map(m=>m[1]);
 assert.deepEqual(displayed,markets.FORECAST_SYMBOLS);
 assert.match(page,/32 инструмента/);
 assert.doesNotThrow(()=>new Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]));
});

test('new symbols are allowed for read-only forecast, but never order permission',()=>{
 const template=symbol=>({
  mode:'STANDALONE_WEEX_FORECAST_1_5_10',symbol,exchange:'WEEX',
  available:true,notTrade:true,ordersSent:0,signalPermission:false,
  combinedDirection:'LONG_BIAS',alignment:'THREE_TIMEFRAME_ALIGNMENT',
  timeframes:[1,5,10].map(i=>({
   intervalMinutes:i,closedAt:Date.UTC(2026,10,11,10,0),
   direction:'LONG_BIAS',rsi14:60,relativeVolume:1.1,atr14:1.2
  }))
 });
 const now=Date.UTC(2026,10,11,10,0,30);
 for(const symbol of added){
  assert.equal(forecastEligible(template(symbol),now),true,symbol);
  assert.equal(forecastEligible({...template(symbol),signalPermission:true},now),false,symbol);
 }
 const disallowed=template('FORDUSDT');
 assert.equal(forecastEligible(disallowed,now),false);
 const notifications=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 assert.match(notifications,/symbols=marketSafety\.FORECAST_SYMBOLS/);
 assert.match(notifications,/MAX_PER_BUCKET=2/);
 for(const banned of [/trade-prepare/,/trade-confirm/,/placeOrder\(/,/WEEX_API_SECRET/])
  assert.doesNotMatch(notifications,banned);
});
