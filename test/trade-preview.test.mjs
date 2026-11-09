import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyPlan,TRADE_LIMITS} from '../lib/trade-plan.mjs';
const now=1762510000000;
const signal={status:'ok',exchange:'WEEX',symbol:'XRPUSDT',direction:'LONG',level:'STRONG',price:2,stop:1.98,take:2.06,candleCloseTime:now-30000,expiresAt:now+120000};
const book={symbol:'XRPUSDT',bidPrice:'1.999',askPrice:'2.001',time:now};
const market={symbol:'XRPUSDT',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',forwardContractFlag:true,maxLeverage:50,quantityPrecision:3,pricePrecision:4,minOrderSize:1,marketOpenLimitSize:100000};
test('preview is never executable and uses fixed limits',()=>{
  const p=createReadOnlyPlan(signal,book,market,now);
  assert.equal(p.canPlaceOrder,false);assert.equal(p.status,'PREVIEW_ONLY');
  assert.equal(p.leverage,10);assert.equal(p.marginUsdt,50);assert.equal(p.maxConcurrent,2);
  assert.ok(p.notionalEstimate<=500);assert.ok(p.estimatedLossUsdt<=TRADE_LIMITS.maxRiskUsdt);
  assert.equal(p.costGate,'PASS_ESTIMATE');
  assert.ok(p.estimatedNetLossUsdt>=p.estimatedLossUsdt);
  assert.ok(p.estimatedNetLossUsdt<=TRADE_LIMITS.maxRiskUsdt);
  assert.ok(p.estimatedNetProfitUsdt>0);
  assert.ok(p.estimatedNetRR>=1.5);
  assert.equal(p.costAssumptions.feeBpsEachSide,8);
  assert.equal(p.costAssumptions.slippageBpsEachSide,3);
});
test('never trades Bybit fallback',()=>{
  assert.throws(()=>createReadOnlyPlan({...signal,exchange:'Bybit'},book,market,now),/WEEX/);
});
test('never previews expired or stale signals',()=>{
  assert.throws(()=>createReadOnlyPlan({...signal,expiresAt:now+1000},book,market,now),/expired/);
  assert.throws(()=>createReadOnlyPlan(signal,{...book,time:now-40000},market,now),/Outdated/);
});
test('rejects excessive risk and invalid market',()=>{
  assert.throws(()=>createReadOnlyPlan({...signal,stop:1.90},book,market,now),/risk cap/);
  assert.throws(()=>createReadOnlyPlan(signal,book,{...market,maxLeverage:5},now),/unsupported/);
});
test('short orientation is validated',()=>{
  const s={...signal,direction:'SHORT',stop:2.02,take:1.94};
  const p=createReadOnlyPlan(s,book,market,now);
  assert.ok(p.stopLoss>p.entryEstimate&&p.takeProfit<p.entryEstimate);
});

test('WEEX quantityPrecision -1 safely falls back to documented baseAssetPrecision',()=>{
 const m={...market,quantityPrecision:-1,baseAssetPrecision:4,minOrderSize:10};
 const result=createReadOnlyPlan(signal,book,m,now);
 assert.match(result.quantity,/^\d+(?:\.\d{1,4})?$/);
 assert.ok(result.notionalEstimate<=500&&result.notionalEstimate>=475);
 assert.throws(()=>createReadOnlyPlan(signal,book,{...m,baseAssetPrecision:-1},now),/precision/);
 assert.throws(()=>createReadOnlyPlan(signal,book,{...m,quantityPrecision:-2},now),/precision/);
});


test('no live proposal if gross risk passes but modeled risk WITH costs exceeds 10 USDT',()=>{
 const tight={...signal,stop:1.965,take:2.09};
 // Approx 9 USDT stop before costs; fees, spread and slippage push it over 10.
 assert.throws(()=>createReadOnlyPlan(tight,book,market,now),/after fees and slippage/);
});

test('no live proposal with positive gross target but inadequate NET R/R',()=>{
 const grossLooksPositive={...signal,stop:1.98,take:2.035};
 assert.throws(()=>createReadOnlyPlan(grossLooksPositive,book,market,now),/net reward\/risk/);
});

test('SHORT is also subject to the mandatory cost-aware net risk gate',()=>{
 const short={...signal,direction:'SHORT',stop:2.035,take:1.91};
 assert.throws(()=>createReadOnlyPlan(short,book,market,now),/after fees and slippage/);
});

test('missing or extreme cost inputs fail closed',()=>{
 const spread={...book,bidPrice:'1.990',askPrice:'2.010'};
 assert.throws(()=>createReadOnlyPlan(signal,spread,market,now),/costs|risk cap|risk after fees|estimated/);
});
