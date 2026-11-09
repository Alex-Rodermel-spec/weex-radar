import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {berlinTradingDay,dayTradeKey} from '../lib/trade-trial-guard.mjs';

test('Berlin trading day changes at local midnight in winter and summer',()=>{
 assert.equal(berlinTradingDay(Date.parse('2026-11-09T22:59:59Z')),'2026-11-09');
 assert.equal(berlinTradingDay(Date.parse('2026-11-09T23:00:00Z')),'2026-11-10');
 assert.equal(berlinTradingDay(Date.parse('2026-07-01T21:59:59Z')),'2026-07-01');
 assert.equal(berlinTradingDay(Date.parse('2026-07-01T22:00:00Z')),'2026-07-02');
 assert.equal(dayTradeKey(Date.parse('2026-11-09T23:00:00Z')),
   'trading/trial-one-order-per-day/2026-11-10.json');
 assert.throws(()=>berlinTradingDay(NaN),/Invalid timestamp/);
});

test('prepare checks private daily record, while confirm uses atomic no-overwrite reservation BEFORE sending order',()=>{
 const prepare=readFileSync(new URL('../api/trade-prepare.mjs',import.meta.url),'utf8');
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
 assert.match(prepare,/get\(dayTradeKey\(\),\{access:'private'\}\)/);
 assert.match(confirm,/dailyPath=dayTradeKey\(\)/);
 assert.match(confirm,/await put\(dailyPath/);
 assert.match(confirm,/allowOverwrite:false,addRandomSuffix:false/);
 assert.ok(confirm.indexOf('await put(dailyPath')<confirm.indexOf('orderAttempted=true'));
 assert.ok(confirm.indexOf('orderAttempted=true')<confirm.indexOf('await weex.placeOrder(order)'));
 assert.match(confirm,/if\(dailyReserved&&!orderAttempted\)/);
 assert.match(confirm,/if\(locked&&!orderAttempted\)/);
 assert.match(page,/1 новая заявка в день/);
 assert.match(page,/НЕ лимит фактических дневных убытков/);
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
