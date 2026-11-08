import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {normalizeBook,summarizeLiquidity,simulateNotional,DEFAULT_NOTIONAL_USDT} from '../lib/liquidity-analysis.mjs';
import {handleLiquidity} from '../lib/liquidity-route.mjs';

const book={
 bids:[['99.8','20'],['99.9','10']],
 asks:[['100.2','20'],['100.1','10']],
 lastUpdateId:123456789
};
function res(){
 return {statusCode:200,payload:null,headers:{},
  setHeader(k,v){this.headers[k]=v;return this},
  status(v){this.statusCode=v;return this},
  json(x){this.payload=x;return this}};
}

test('WEEX depth computes bid/ask spread and quote depth with correct sides',()=>{
 const normalized=normalizeBook(book);
 assert.equal(normalized.bestBid,99.9);
 assert.equal(normalized.bestAsk,100.1);
 assert.equal(DEFAULT_NOTIONAL_USDT,2500);
 const data=summarizeLiquidity(book,2500);
 assert.equal(data.spreadBps,20);
 assert.equal(data.spreadPct,0.2);
 assert.equal(data.spreadLabel,'Средний');
 assert.equal(data.depthLimit,200);
 assert.equal(data.long.fullFill,true);
 assert.equal(data.short.fullFill,true);
 assert.equal(data.long.averagePrice,100.16);
 assert.equal(data.short.averagePrice,99.84);
 assert.ok(data.long.impactBps>0);
 assert.ok(data.short.impactBps>0);
 assert.equal(data.nearDepthUSDT.ask025,3005);
 assert.equal(data.nearDepthUSDT.bid025,2995);
});

test('insufficient visible depth never reports zero slippage as a good result',()=>{
 const d=summarizeLiquidity({bids:[['99.9','0.2']],asks:[['100.1','0.1']]},2500);
 assert.equal(d.long.fullFill,false);
 assert.equal(d.short.fullFill,false);
 assert.equal(d.long.impactBps,null);
 assert.equal(d.short.averagePrice,null);
 assert.equal(d.long.assessment,'Видимой глубины недостаточно');
 assert.ok(d.long.coveredPct<2);
});

test('reject crossed, malformed, inverted or nonpositive books',()=>{
 for(const b of [
  {bids:[],asks:[['100','1']]},
  {bids:[['101','1']],asks:[['100','1']]},
  {bids:[['99.9','-2']],asks:[['100','1']]},
  {bids:[['99.9','1']],asks:[['wat','1']]},
  {bids:[['99.9','1']],asks:[['100','0']]},
  {bids:[['99.9','1']],asks:[['100','1']].concat(Array.from({length:201},()=>['101','1']))}
 ])assert.throws(()=>normalizeBook(b));
 assert.throws(()=>summarizeLiquidity(book,50),/от 100/);
 assert.throws(()=>summarizeLiquidity(book,15000),/от 100/);
});

test('model uses amount / midpoint not quote-volume filled in opposite direction',()=>{
 const normalized=normalizeBook(book);
 const b=simulateNotional(normalized.bids,normalized.mid,2500,'SHORT');
 assert.equal(b.averagePrice,99.84);
 assert.ok(b.impactBps>=0);
 const a=simulateNotional(normalized.asks,normalized.mid,2500,'LONG');
 assert.equal(a.averagePrice,100.16);
});

test('route is read-only, public, single WEEX depth symbol and never auto-orders',async()=>{
 const fetchOriginal=globalThis.fetch;
 let calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  return {ok:true,status:200,json:async()=>book};
 };
 try{
  const okay=res();
  await handleLiquidity({method:'GET',url:'/api/signals?mode=liquidity&symbol=BTCUSDT&notional=2500'},okay,['BTCUSDT','XRPUSDT']);
  assert.equal(okay.statusCode,200);
  assert.equal(okay.payload.symbol,'BTCUSDT');
  assert.equal(okay.payload.exchange,'WEEX');
  assert.equal(okay.payload.mode,'observation-only');
  assert.equal(okay.payload.ordersEnabled,false);
  assert.match(calls[0].url,/^https:\/\/api-contract\.weex\.com\/capi\/v3\/market\/depth\?symbol=BTCUSDT&limit=200$/);
  assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls.length,1);
  assert.equal(res().statusCode,200);
  const bad=res();
  await handleLiquidity({method:'GET',url:'/api/signals?mode=liquidity&symbol=SPAMUSDT'},bad,['BTCUSDT']);
  assert.equal(bad.statusCode,400);
  assert.equal(calls.length,1);
  const invalid=res();
  await handleLiquidity({method:'GET',url:'/api/signals?mode=liquidity&symbol=BTCUSDT&notional=1000000'},invalid,['BTCUSDT']);
  assert.equal(invalid.statusCode,400);
  assert.equal(calls.length,1);
  const forbidden=res();
  await handleLiquidity({method:'POST',url:'/api/signals?mode=liquidity&symbol=BTCUSDT'},forbidden,['BTCUSDT']);
  assert.equal(forbidden.statusCode,405);
 }finally{globalThis.fetch=fetchOriginal}
});

test('status UI and code do not modify cron, signal filters or trades',()=>{
 const page=readFileSync(new URL('../liquidity.html',import.meta.url),'utf8');
 const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/liquidity-route.mjs',import.meta.url),'utf8');
 const main=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'liquidity.html'}));
 assert.match(page,/mode=liquidity/);
 assert.match(home,/href="\/liquidity\.html"/);
 assert.match(home,/Проверить стакан WEEX/);
 assert.match(main,/mode==='liquidity'/);
 assert.match(main,/handleLiquidity\(req,res,SYMBOLS\)/);
 assert.doesNotMatch(route,/trade-confirm|\/capi\/v3\/order|WEEX_API_SECRET|@vercel\/blob/);
 assert.doesNotMatch(route,/Bybit|api\.bybit\.com/);
});
