import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ACTIVE_STRATEGY} from '../lib/strategy-profile.mjs';
import {COST_MIN_NET_RR,assessNetCosts} from '../lib/net-costs.mjs';
import {createReadOnlyPlan,TRADE_LIMITS} from '../lib/trade-plan.mjs';
import {orderPayload} from '../lib/weex-order.mjs';
import {alertPresentation} from '../lib/alert-presentation.mjs';
import {adviseSymbol} from '../lib/advisor.mjs';

const now=Date.UTC(2026,10,9,18,0,0);
const signal={status:'ok',exchange:'WEEX',symbol:'XRPUSDT',
 direction:'LONG',level:'NORMAL',price:100,livePrice:100,
 stop:99.4,take:101.4,candleCloseTime:now-15000,
 expiresAt:now+120000,entryQuality:{ok:true,rr:2.33},
 filterDiagnostic:{stage:'ready'}};
const market={symbol:'XRPUSDT',quoteAsset:'USDT',marginAsset:'USDT',
 contractType:'PERPETUAL',forwardContractFlag:true,maxLeverage:50,
 quantityPrecision:3,pricePrecision:4,minOrderSize:1,marketOpenLimitSize:100000};
const book={symbol:'XRPUSDT',bidPrice:'99.99',askPrice:'100.01',time:now};
const cost=assessNetCosts({
 exchange:'WEEX',direction:'LONG',entryMid:100,stop:99.4,
 take:101.4,bid:99.99,ask:100.01
});
test('moderate profile changes reward target and cost acceptance, never the loss budget',()=>{
 assert.equal(ACTIVE_STRATEGY.name,'MODERATE_MANUAL');
 assert.equal(ACTIVE_STRATEGY.stopAtr,1.2);
 assert.equal(ACTIVE_STRATEGY.takeAtr,3);
 assert.equal(ACTIVE_STRATEGY.minNetRR,1.3);
 assert.equal(COST_MIN_NET_RR,1.3);
 assert.deepEqual(TRADE_LIMITS,{marginUsdt:50,leverage:10,
  maxConcurrent:2,maxRiskUsdt:10});
 assert.equal(ACTIVE_STRATEGY.phase,'EXPERIMENTAL');
});
test('cost-passing normal fresh breakout is visible as manual check even without a completed retest',()=>{
 assert.ok(cost.netRR>=1.3&&cost.netRR<1.5);
 assert.equal(cost.status,'PASS_ESTIMATE');
 const prepared={...signal,costReview:cost,retest:{LONG:null}};
 const message=alertPresentation(prepared);
 assert.equal(message.status,'CHECK');
 assert.match(message.reason,/ретест ещё не подтверждён/);
 assert.equal(adviseSymbol(prepared,now).status,'REVIEW');
 assert.equal(adviseSymbol({...prepared,retest:{LONG:{status:'FAILED'}}},now).status,'SKIP');
 assert.equal(adviseSymbol({...prepared,expiresAt:now+9000},now).status,'SKIP');
});
test('a moderate candidate can generate ONLY a read-only guarded market proposal',()=>{
 const plan=createReadOnlyPlan(signal,book,market,now);
 assert.equal(plan.canPlaceOrder,false);
 assert.equal(plan.status,'PREVIEW_ONLY');
 assert.equal(plan.costGate,'PASS_ESTIMATE');
 assert.ok(plan.estimatedNetRR>=1.3&&plan.estimatedNetRR<1.5);
 assert.ok(plan.estimatedNetLossUsdt<=10);
 assert.ok(plan.estimatedNetLossUsdt>=plan.estimatedLossUsdt);
 assert.equal(plan.marginUsdt,50);
 assert.equal(plan.leverage,10);
 const payload=orderPayload(plan);
 assert.equal(payload.type,'MARKET');
 assert.equal(payload.side,'BUY');
 assert.equal(payload.symbol,'XRPUSDT');
 assert.equal(payload.slTriggerPrice,String(plan.stopLoss));
 assert.equal(payload.tpTriggerPrice,String(plan.takeProfit));
 assert.equal(payload.reduceOnly,false);
});
test('WEEX-only, insufficient return, excessive stop, stale quote, and expired proposals still reject',()=>{
 assert.throws(()=>createReadOnlyPlan({...signal,exchange:'Bybit'},book,market,now),/WEEX/);
 assert.throws(()=>createReadOnlyPlan({...signal,take:101.1},book,market,now),/net reward\/risk/);
 assert.throws(()=>createReadOnlyPlan({...signal,stop:97.5},book,market,now),/risk cap/);
 assert.throws(()=>createReadOnlyPlan(signal,{...book,time:now-40000},market,now),/Outdated/);
 assert.throws(()=>createReadOnlyPlan({...signal,expiresAt:now+10000},book,market,now),/expired/);
 assert.throws(()=>orderPayload({...createReadOnlyPlan(signal,book,market,now),
  estimatedNetRR:1.299}),/Unsafe/);
});
test('only real human confirmation can call live order; no auto execution was enabled',()=>{
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 const prepare=readFileSync(new URL('../api/trade-prepare.mjs',import.meta.url),'utf8');
 const order=readFileSync(new URL('../lib/weex-order.mjs',import.meta.url),'utf8');
 const cron=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const scan=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(confirm,/CONFIRM_REAL_WEEX_ORDER/);
 assert.match(confirm,/verifyLiveTradePasskey/);
 assert.match(confirm,/authenticatedTradeSession/);
 assert.match(confirm,/verifyActiveProtection/);
 assert.match(confirm,/await put\(LOCK,/);
 assert.match(order,/liveEnabled\(\)/);
 assert.match(order,/TRADE_LIMITS\.maxConcurrent/);
 assert.match(prepare,/authenticatedTradeSession/);
 assert.doesNotMatch(cron,/weex\.placeOrder|trade-confirm|trade-prepare/);
 assert.doesNotMatch(scan,/weex\.placeOrder|trade-confirm/);
});
