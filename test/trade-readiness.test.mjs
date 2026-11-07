import test from 'node:test';
import assert from 'node:assert/strict';
import {readinessSummary} from '../lib/trade-readiness.mjs';
const now=1794029800000;
const example={
 symbol:'XRPUSDT',
 account:{canTrade:true,dualSidePosition:true},
 balance:[{asset:'USDT',availableBalance:'70.00'}],
 positions:[{symbol:'BTCUSDT',size:'0.01'}],
 orders:[],
 settings:[{symbol:'XRPUSDT',separatedType:'COMBINED',marginType:'ISOLATED',isolatedLongLeverage:'10',isolatedShortLeverage:'10'}],
 info:{symbols:[{symbol:'XRPUSDT',quoteAsset:'USDT',marginAsset:'USDT',contractType:'PERPETUAL',forwardContractFlag:true,maxLeverage:50,minOrderSize:'1',quantityPrecision:-1,baseAssetPrecision:4,pricePrecision:4}]},
 book:{symbol:'XRPUSDT',bidPrice:'2.00',askPrice:'2.001',time:now},
 apiTradingSymbols:['BTCUSDT','XRPUSDT']
};
test('readiness is only facts, not proof of real order ability',()=>{
 const s=readinessSummary(example,now);
 assert.equal(s.passed,true);assert.equal(s.isolated10x,true);
 assert.equal(s.apiOrderPermission,'NOT_VERIFIED');assert.equal(s.ordersSent,0);
});
test('preflight rejects API-blocked coins, insufficient margin, same-coin positions and stale quotes',()=>{
 assert.equal(readinessSummary({...example,apiTradingSymbols:['BTCUSDT']},now).checks.apiListed,false);
 assert.equal(readinessSummary({...example,balance:[{asset:'USDT',availableBalance:'49'}]},now).checks.collateral55Usdt,false);
 assert.equal(readinessSummary({...example,positions:[{symbol:'XRPUSDT',size:'1'}]},now).checks.noSameCoinPosition,false);
 assert.equal(readinessSummary({...example,book:{...example.book,time:now-60000}},now).checks.freshOrderBook,false);
});
test('unsupported setting can be detected before any trade',()=>{
 const summary=readinessSummary({...example,settings:[{symbol:'XRPUSDT',separatedType:'COMBINED',marginType:'CROSSED'}]},now);
 assert.equal(summary.passed,true);
 assert.equal(summary.requiresLeverageSetup,true);
});

test('unknown precision blocks preflight rather than assuming an order size',()=>{
 const invalid={...example,info:{symbols:[{...example.info.symbols[0],quantityPrecision:-2}]}};
 assert.equal(readinessSummary(invalid,now).checks.quantityPrecisionValid,false);
});
