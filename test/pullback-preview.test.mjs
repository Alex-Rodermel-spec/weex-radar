import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {planPullbackPreview} from '../lib/pullback-preview.mjs';
const NOW=Date.UTC(2026,10,9,12,10,45);
const lastClose=NOW-45_000;
const signal={
 symbol:'XRPUSDT',status:'ok',exchange:'WEEX',direction:'LONG',
 stop:99.5,take:102,closeTime:lastClose,
 candleCloseTime:lastClose,expiresAt:NOW+90_000
};
const quote={bidPrice:'100',askPrice:'100.02',time:NOW-2000};
const recent=()=>Array.from({length:4},(_,i)=>{
 const time=lastClose-(3-i)*60_000;
 return {time,closeTime:time+60_000,open:100.01,high:100.25,low:99.85,close:100.03,volume:100};
});
function plan(extra={}){return planPullbackPreview({signal,quote,candles:recent(),pricePrecision:4,now:NOW,...extra});}

test('LONG picks low of previous 3 CLOSED 1m candles; never places an order',()=>{
 const r=plan();
 assert.equal(r.status,'PREVIEW_ONLY');
 assert.equal(r.mode,'CLOSED_1M_PULLBACK');
 assert.equal(r.canPlaceOrder,false);
 assert.equal(r.limitPrice,99.85);
 assert.equal(r.marketEntryEstimate,100.02);
 assert.equal(r.stopLoss,99.5);
 assert.ok(r.expiresAt<=signal.expiresAt);
 assert.equal(r.gapPercent,0.17);
});

test('SHORT proposes a sell on a bounce above current ask',()=>{
 const result=plan({signal:{...signal,direction:'SHORT',stop:100.5,take:98}});
 assert.equal(result.direction,'SHORT');
 assert.equal(result.limitPrice,100.25);
 assert.ok(result.limitPrice>100.02);
 assert.ok(result.stopLoss>result.limitPrice);
});

test('rounding does not make limit marketable, cross TP/SL or use incomplete candles',()=>{
 assert.equal(plan({pricePrecision:-1}),null);
 assert.equal(plan({candles:recent().map((c,i)=>i===3?{...c,closeTime:NOW+15_000}:c)}),null);
 assert.equal(plan({candles:recent().map((c,i)=>i===3?{...c,time:c.time-60_000}:c)}),null);
 assert.equal(plan({candles:recent().map(c=>({...c,low:100.01}))}),null);
 assert.equal(plan({candles:recent().map(c=>({...c,low:99.4}))}),null);
 assert.equal(plan({signal:{...signal,stop:99.9}}),null);
});

test('stale signals, expired approval, wrong exchange, bad and stale book never show a candidate',()=>{
 assert.equal(plan({signal:{...signal,direction:null}}),null);
 assert.equal(plan({signal:{...signal,exchange:'Bybit'}}),null);
 assert.equal(plan({signal:{...signal,expiresAt:NOW+20_000}}),null);
 assert.equal(plan({signal:{...signal,candleCloseTime:NOW-210_000}}),null);
 assert.equal(plan({quote:{...quote,time:NOW-40_000}}),null);
 assert.equal(plan({quote:{...quote,askPrice:'99.99'}}),null);
});

test('only a preview endpoint and passive UI are added; existing trade-confirm stays MARKET',()=>{
 const page=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
 const route=readFileSync(new URL('../api/pullback-preview.mjs',import.meta.url),'utf8');
 const calc=readFileSync(new URL('../lib/pullback-preview.mjs',import.meta.url),'utf8');
 const execution=readFileSync(new URL('../lib/weex-order.mjs',import.meta.url),'utf8');
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 assert.match(page,/id="pullback"/);
 assert.match(page,/\/api\/pullback-preview/);
 assert.match(route,/scanSymbol\(symbol\)/);
 assert.match(route,/interval=1m/);
 assert.match(execution,/positionSide:plan.direction,type:'MARKET'/);
 assert.match(confirm,/orderPayload\(finalPlan\)/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'trade.html'}));
 for(const t of [route,calc])assert.doesNotMatch(t,
  /placeOrder|trade-confirm|trade-prepare|BLOB_READ_WRITE_TOKEN|PUSH_CRON_KEY|WEEX_API_SECRET/);
});
