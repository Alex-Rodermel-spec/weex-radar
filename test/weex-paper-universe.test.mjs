import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_MARKETS,EXTRA_CANDIDATES,PINNED_EXTRA_MARKETS,
 PAPER_ALLOWED,selectWeexPaperMarkets,handleWeexPaperUniverse}
 from '../lib/weex-paper-universe.mjs';

function res(){
 return {code:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(code){this.code=code;return this},
  json(x){this.body=x;return this}};
}
function reply(body){
 return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(body)};
}
test('pinned 50 verified pairs plus the original 16 form exactly 66, no duplicates',()=>{
 assert.equal(BASE_MARKETS.length,16);
 assert.equal(PINNED_EXTRA_MARKETS.length,50);
 assert.equal(new Set([...BASE_MARKETS,...PINNED_EXTRA_MARKETS]).size,66);
 assert.ok(PINNED_EXTRA_MARKETS.every(x=>EXTRA_CANDIDATES.includes(x)));
 const all=[...BASE_MARKETS,...EXTRA_CANDIDATES];
 const v=selectWeexPaperMarkets(all);
 assert.deepEqual(v.baseMarkets,BASE_MARKETS);
 assert.deepEqual(v.extraMarkets,PINNED_EXTRA_MARKETS);
 assert.equal(v.markets.length,66);
 assert.equal(v.totalMarkets,66);
 assert.equal(v.selection,'WEEX_PINNED_TOP50');
 assert.equal(v.ordersSent,0);
 assert.equal(v.notATrade,true);
 assert.ok(v.markets.every(x=>PAPER_ALLOWED.includes(x)));
});
test('delisted pinned symbols get only verified replacements, never duplicates',()=>{
 const official=[...BASE_MARKETS,...EXTRA_CANDIDATES].filter(x=>x!==PINNED_EXTRA_MARKETS[0]);
 const v=selectWeexPaperMarkets(official);
 assert.equal(v.extraMarkets.length,50);
 assert.ok(!v.extraMarkets.includes(PINNED_EXTRA_MARKETS[0]));
 assert.ok(v.extraMarkets.includes(PINNED_EXTRA_MARKETS[1]));
 assert.ok(v.extraMarkets.every(x=>official.includes(x)));
 assert.equal(v.selection,'WEEX_ELIGIBLE_REPLACEMENTS');
});
test('unverified and malformed universe fails closed',()=>{
 assert.throws(()=>selectWeexPaperMarkets([]));
 assert.throws(()=>selectWeexPaperMarkets(['BTCUSDT']));
 assert.throws(()=>selectWeexPaperMarkets(Array.from({length:60},()=>123)));
 assert.throws(()=>selectWeexPaperMarkets(BASE_MARKETS),/INVALID_WEEX_ELIGIBILITY|FEWER_THAN_50/);
});
test('WEEX universe endpoint uses official public API only, one request for stable eligible 50',async()=>{
 const seen=[];
 const response=res();
 const fetchImpl=async(u,opts)=>{
  seen.push([u,opts]);return reply([...BASE_MARKETS,...EXTRA_CANDIDATES]);
 };
 await handleWeexPaperUniverse({method:'GET'},response,{fetchImpl});
 assert.equal(response.code,200,JSON.stringify(response.body));
 assert.equal(response.body.mode,'WEEX_PAPER_UNIVERSE');
 assert.equal(response.body.totalMarkets,66);
 assert.equal(response.body.extraMarkets.length,50);
 assert.equal(response.headers['Cache-Control'],'no-store');
 assert.equal(seen.length,1);
 assert.equal(seen[0][0],
  'https://api-contract.weex.com/capi/v3/market/apiTradingSymbols');
 assert.equal(seen[0][1].cache,'no-store');
 assert.equal(response.body.notATrade,true);
 assert.equal(response.body.ordersSent,0);
});
test('unavailable official pair list never invents new contracts',async()=>{
 const r=res();
 await handleWeexPaperUniverse({method:'GET'},r,{fetchImpl:async()=>reply([])});
 assert.equal(r.code,503);
 assert.equal(r.body.ordersSent,0);
 assert.ok(!r.body.extraMarkets);
});
test('WEEX universe has no account keys, orders, cron or paid modules',()=>{
 const src=readFileSync(new URL('../lib/weex-paper-universe.mjs',import.meta.url),'utf8');
 for(const re of [/process\.env/,/Authorization:/i,/placeOrder/,/trade-confirm/,
   /ntfySend/,/cron-key/,/api-secret/i,/auto-trad(e|ing)/i]){
  assert.doesNotMatch(src,re);
 }
});
test('browser PAPER page validates 66 markets before starting expanded scans',()=>{
 const html=readFileSync(new URL('../paper-five.html',import.meta.url),'utf8');
 assert.match(html,/universe=1/);
 assert.match(html,/extraMarkets\.length!==50/);
 assert.match(html,/d\.markets\.length!==66/);
 assert.match(html,/CONCURRENCY=16/);
 assert.match(html,/WEEX_66_MARKETS_NOT_VERIFIED/);
 assert.match(html,/async function initialize/);
 assert.match(html,/id="universe-status"/);
});
