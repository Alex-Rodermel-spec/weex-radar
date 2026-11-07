import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyActiveProtection} from '../lib/trade-protection.mjs';
const plan={symbol:'XRPUSDT',direction:'LONG',stopLoss:1.9,takeProfit:2.2};
const position={symbol:'XRPUSDT',side:'LONG',size:'10'};
const stop={symbol:'XRPUSDT',positionSide:'LONG',side:'SELL',algoStatus:'UNTRIGGERED',orderType:'STOP_MARKET',triggerPrice:'1.9',quantity:'10',reduceOnly:true};
const take={...stop,orderType:'TAKE_PROFIT_MARKET',triggerPrice:'2.2'};
test('both active closing orders are mandatory',()=>{
 assert.deepEqual(verifyActiveProtection([stop,take],plan,position),{verified:true,stop:true,take:true});
 for(const set of [[stop],[take],[],[{...stop,reduceOnly:false},take],[{...stop,algoStatus:'CANCELED'},take],[{...stop,side:'BUY'},take],[{...stop,quantity:'5'},take]])assert.equal(verifyActiveProtection(set,plan,position).verified,false);
 assert.equal(verifyActiveProtection(null,plan,position).verified,false);
});
test('full-close orders are supported',()=>{
 const a={...stop,reduceOnly:false,closePosition:true,quantity:'0'};
 const b={...take,reduceOnly:false,closePosition:true,quantity:'0'};
 assert.equal(verifyActiveProtection([a,b],plan,position).verified,true);
});
