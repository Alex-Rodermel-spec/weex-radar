import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('multiple separate trades per Berlin day are allowed after fresh approval',()=>{
 const prepare=readFileSync(new URL('../api/trade-prepare.mjs',import.meta.url),'utf8');
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
 for(const source of [prepare,confirm]){
   assert.doesNotMatch(source,/dayTradeKey|dailyReserved|dailyPath|one bot trade per Berlin day/);
   assert.doesNotMatch(source,/trial-one-order-per-day/);
 }
 assert.match(page,/несколько подтверждённых сделок в день разрешены/i);
 assert.doesNotMatch(page,/1 новая заявка в день/);
});

test('global atomic lock, per-signal idempotency and explicit human approval are unchanged',()=>{
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 const prepare=readFileSync(new URL('../api/trade-prepare.mjs',import.meta.url),'utf8');
 const order=readFileSync(new URL('../lib/weex-order.mjs',import.meta.url),'utf8');
 assert.match(confirm,/await put\(LOCK,/);
 assert.match(confirm,/allowOverwrite:false,addRandomSuffix:false/);
 assert.match(confirm,/await put\('trading\/consumed\/'/);
 assert.match(confirm,/await put\('trading\/signals\/'/);
 assert.match(confirm,/orderAttempted=true/);
 assert.match(confirm,/if\(locked&&!orderAttempted\)/);
 assert.match(confirm,/CONFIRM_REAL_WEEX_ORDER/);
 assert.match(confirm,/validateHumanPassword/);
 assert.match(prepare,/validateHumanPassword/);
 assert.match(order,/TRADE_LIMITS\.maxConcurrent/);
});

test('server checks actual active TP and SL following accepted order, still requires manual verified release',()=>{
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 const release=readFileSync(new URL('../api/trade-release.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
 assert.match(confirm,/weex\.openAlgoOrders\(plan\.symbol\)/);
 assert.match(confirm,/verifyActiveProtection\(algo,finalPlan,p\)/);
 assert.match(confirm,/protectionVerified:protection\.verified/);
 assert.match(confirm,/URGENT: WEEX did NOT verify BOTH/);
 assert.match(release,/verifyActiveProtection\(algoOrders,lock,same\[0\]\)/);
 assert.match(page,/d\.protectionVerified/);
 assert.doesNotMatch(confirm,/closeUnprotected\(plan\.symbol,p\)/);
});