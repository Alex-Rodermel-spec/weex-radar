import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyPlan,TRADE_LIMITS} from '../lib/trade-plan.mjs';
const now=1762510000000;
const signal={status:'ok',exchange:'WEEX',symbol:'XRPUSDT',direction:'LONG',level:'STRONG',price:2,stop:1.98,take:2.04,candleCloseTime:now-30000,expiresAt:now+120000};
const book={symbol:'XRPUSDT',bidPrice:'1.999',askPrice:'2.001',time:now};
const market={symbol:'XRPUSDT',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',forwardContractFlag:true,maxLeverage:50,quantityPrecision:3,pricePrecision:4,minOrderSize:1,marketOpenLimitSize:100000};
test('preview is never executable and uses fixed limits',()=>{
  const p=createReadOnlyPlan(signal,book,market,now);
  assert.equal(p.canPlaceOrder,false);assert.equal(p.status,'PREVIEW_ONLY');
  assert.equal(p.leverage,10);assert.equal(p.marginUsdt,50);assert.equal(p.maxConcurrent,3);
  assert.ok(p.notionalEstimate<=500);assert.ok(p.estimatedLossUsdt<=TRADE_LIMITS.maxRiskUsdt);
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
  const s={...signal,direction:'SHORT',stop:2.02,take:1.96};
  const p=createReadOnlyPlan(s,book,market,now);
  assert.ok(p.stopLoss>p.entryEstimate&&p.takeProfit<p.entryEstimate);
});
