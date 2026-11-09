import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 ownershipPath,normalizeActivePositions,classifyPositions,readOwnedPortfolio,
 verifyOtherBotProtection,ownershipReceipt
} from '../lib/trade-ownership.mjs';

const now=Date.now(),created=now-20000;
const sym=(symbol,id='689987235755328123',size='250')=>({
 id,symbol,side:'LONG',size,createdTime:created,
 marginType:'ISOLATED',leverage:'10'
});
const botPosition=sym('BTCUSDT');
const manualPosition=sym('ETHUSDT','689987235755328124');
const otherBot=sym('SOLUSDT','689987235755328125','1');
const orderId='702345678901234567',clientOrderId='radar-'+'a'.repeat(25);
function receipt(p=botPosition,qty=p.size){
 return {
 version:1,symbol:p.symbol,direction:p.side,
 positionId:p.id,positionCreatedAt:p.createdTime,openingOrderId:orderId,
 clientOrderId,recordedSize:qty,stopLoss:1.9,takeProfit:2.1,recordedAt:now
 };
}
const fakeRead=docs=>async path=>{
 const row=docs.get(path);
 return row?{stream:new Response(JSON.stringify(row)).body}:null;
};

test('manual WEEX position is excluded from two RADAR-owned slots',async()=>{
 const rows=[botPosition,manualPosition,otherBot];
 const recordMap=new Map([[ownershipPath('BTCUSDT'),receipt(botPosition)],
  [ownershipPath('SOLUSDT'),receipt(otherBot)]]);
 const {bot,manual,botOpenPositions,manualOpenPositions,totalOpenPositions}=
   await readOwnedPortfolio(rows,fakeRead(recordMap));
 assert.equal(botOpenPositions,2);
 assert.equal(manualOpenPositions,1);
 assert.equal(totalOpenPositions,3);
 assert.equal(bot.length,2);
 assert.equal(manual[0].symbol,'ETHUSDT');
});
test('all manual positions are excluded, and receipt for a closed position does not own a new manual one',()=>{
 const old=receipt(botPosition);
 const freshManual={...botPosition,id:'689987235755328128',createdTime:created+5};
 const result=classifyPositions([freshManual,manualPosition],new Map([['BTCUSDT',old]]));
 assert.equal(result.botOpenPositions,0);
 assert.equal(result.manualOpenPositions,2);
});
test('same ID but different created time is ambiguous, not silently manual',()=>{
 assert.throws(()=>classifyPositions([{...botPosition,createdTime:created+1000}],
  new Map([['BTCUSDT',receipt()]])),/Ambiguous/);
});
test('manual additions, leverage changes, unknown positions or bad ownership receipts fail closed',()=>{
 const rows=new Map([['BTCUSDT',receipt()]]);
 assert.throws(()=>classifyPositions([{...botPosition,size:'251'}],rows),/changed manually/);
 assert.throws(()=>classifyPositions([{...botPosition,leverage:'20'}],rows),/changed manually/);
 assert.throws(()=>classifyPositions([{...botPosition,id:null}],rows),/ID/);
 assert.throws(()=>classifyPositions([manualPosition],
  new Map([['ETHUSDT',{...receipt(manualPosition),clientOrderId:'fake'}]])),/receipt/);
 assert.throws(()=>normalizeActivePositions([{symbol:'ADAUSDT',size:'nope'}]),/Invalid/);
 assert.throws(()=>ownershipPath('../api'),/Invalid/);
});
test('partial exit remains bot-owned until position closes',()=>{
 const rows=new Map([['BTCUSDT',receipt()]]);
 assert.equal(classifyPositions([{...botPosition,size:'100'}],rows).botOpenPositions,1);
 assert.equal(classifyPositions([{...botPosition,size:'0'}],rows).botOpenPositions,0);
});
test('new receipt requires verified WEEX filled order AND matching exact position',()=>{
 const plan={symbol:'BTCUSDT',direction:'LONG',stopLoss:1.9,takeProfit:2.1};
 const order={symbol:'BTCUSDT',positionSide:'LONG',newClientOrderId:clientOrderId};
 const detail={symbol:'BTCUSDT',positionSide:'LONG',clientOrderId,orderId,
  status:'FILLED',executedQty:'250'};
 const context={position:botPosition,order,detail,plan,sentAt:created-1000,now};
 const r=ownershipReceipt(context);
 assert.equal(r.positionId,botPosition.id);
 assert.equal(r.openingOrderId,orderId);
 assert.throws(()=>ownershipReceipt({...context,detail:{...detail,status:'NEW'}}),/fill/);
 assert.throws(()=>ownershipReceipt({...context,detail:{...detail,clientOrderId:'wrong'}}),/fill/);
 assert.throws(()=>ownershipReceipt({...context,detail:{...detail,executedQty:'100'}}),/quantity/);
 assert.throws(()=>ownershipReceipt({...context,position:{...botPosition,createdTime:created-70000}}),/identity/);
});
test('every open RADAR position must retain both protective reduce-only orders',async()=>{
 const book=[{symbol:'BTCUSDT',positionSide:'LONG',side:'SELL',
   algoStatus:'NEW',reduceOnly:true,orderType:'STOP_MARKET',quantity:'250',triggerPrice:'1.9'},
  {symbol:'BTCUSDT',positionSide:'LONG',side:'SELL',
   algoStatus:'NEW',reduceOnly:true,orderType:'TAKE_PROFIT_MARKET',quantity:'250',triggerPrice:'2.1'}];
 const portfolio=classifyPositions([botPosition],new Map([['BTCUSDT',receipt()]]));
 assert.equal(await verifyOtherBotProtection(portfolio,async()=>book),true);
 await assert.rejects(()=>verifyOtherBotProtection(portfolio,async()=>book.slice(0,1)),/lacks verified/);
 await assert.rejects(()=>verifyOtherBotProtection(portfolio,async()=>[]),/lacks verified/);
});
test('preflight, confirm and release all resolve bot ownership before allowing new orders',()=>{
 for(const path of ['api/trade-prepare.mjs','api/trade-confirm.mjs','api/trade-preflight.mjs','api/trade-release.mjs']){
  const c=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.match(c,/readOwnedPortfolio/);
  assert.match(c,/verifyOtherBotProtection/);
 }
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 assert.ok(confirm.indexOf('ownershipReceipt({')>confirm.indexOf('await weex.placeOrder(order)'));
 assert.match(confirm,/await put\(ownershipPath\(plan\.symbol\)/);
 assert.match(confirm,/orderAttempted=true/);
 assert.match(confirm,/if\(same\.length>1\)/);
 assert.match(confirm,/CONFIRM_REAL_WEEX_ORDER/);
 const trade=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
 assert.match(trade,/до 2 одновременно открытых позиций RADAR/);
 assert.match(trade,/ручные позиции WEEX учитываются отдельно/);
});
