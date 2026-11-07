import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {createHmac} from 'node:crypto';
import {
  safeEqual,signedHeaders,validateHumanPassword,liveEnabled,requireSameOrigin,
  checkPositions,checkAvailableMargin,checkOrders,checkSymbolSettings,
  orderPayload,isAccepted,clientOrderId,verifyAccount
} from '../lib/weex-order.mjs';
const creds={key:'example_public',secret:'fake_test_secret',passphrase:'fake_test_passphrase'};
const plan={symbol:'XRPUSDT',exchange:'WEEX',direction:'LONG',marginUsdt:50,leverage:10,
  estimatedLossUsdt:5,stopLoss:1.98,takeProfit:2.04,entryEstimate:2,quantity:'250',candleCloseTime:1794027000000};
const backup={...process.env};
test('WEEX V3 signature includes body and GET queries',()=>{
  const body=JSON.stringify({symbol:'XRPUSDT',type:'MARKET'});
  const h=signedHeaders('POST','/capi/v3/order','',body,1794029800000,creds);
  const exp=createHmac('sha256','fake_test_secret')
    .update('1794029800000POST/capi/v3/order'+body).digest('base64');
  assert.equal(h['ACCESS-SIGN'],exp);
  assert.equal(h['ACCESS-KEY'],'example_public');
  assert.throws(()=>signedHeaders('POST','/capi/v3/withdraw','',body,1794029800000,creds),/Unapproved/);
  const get=signedHeaders('GET','/capi/v3/account/symbolConfig','symbol=BTCUSDT','',1794029800000,creds);
  const gx=createHmac('sha256','fake_test_secret')
    .update('1794029800000GET/capi/v3/account/symbolConfig?symbol=BTCUSDT').digest('base64');
  assert.equal(get['ACCESS-SIGN'],gx);
});
test('rejects missing authentication, cross-site requests and disabled live flag',()=>{
  process.env.WEEX_TRADE_APPROVAL_PASSWORD='test-password-with-more-than-20-chars';
  process.env.WEEX_TRADING_ENABLED='false';
  process.env.WEEX_CONFIRM_EACH_ORDER='true';process.env.WEEX_MARGIN_USDT='50';
  process.env.WEEX_LEVERAGE='10';process.env.WEEX_MAX_OPEN_POSITIONS='3';
  assert.equal(validateHumanPassword('test-password-with-more-than-20-chars'),true);
  assert.equal(validateHumanPassword('bad'),false);
  assert.equal(liveEnabled(),false);
  const req={headers:{host:'weex-radar.vercel.app',origin:'https://weex-radar.vercel.app',
    'content-type':'application/json','x-radar-trade-intent':'manual-confirm'}};
  assert.equal(requireSameOrigin(req),true);
  assert.equal(requireSameOrigin({...req,headers:{...req.headers,origin:'https://other.example'}}),false);
  assert.equal(requireSameOrigin({...req,headers:{...req.headers,host:'weex-radar-preview.vercel.app'}}),false);
  process.env.WEEX_TRADING_ENABLED='true';assert.equal(liveEnabled(),true);
  process.env.WEEX_MAX_OPEN_POSITIONS='4';assert.equal(liveEnabled(),false);
  Object.assign(process.env,backup);
});
test('one trade per coin and at most 3 concurrent with pending orders blocked',()=>{
  const p=(symbol)=>({symbol,size:'0.5'});
  assert.equal(checkPositions([p('BTCUSDT'),p('ETHUSDT')],'XRPUSDT'),2);
  assert.throws(()=>checkPositions([p('BTCUSDT'),p('ETHUSDT'),p('SOLUSDT')],'XRPUSDT'),/Maximum/);
  assert.throws(()=>checkPositions([p('XRPUSDT')],'XRPUSDT'),/already/);
  assert.throws(()=>checkOrders([{symbol:'BTCUSDT',reduceOnly:false}]),/Pending/);
  assert.doesNotThrow(()=>checkOrders([{symbol:'BTCUSDT',reduceOnly:true}]));
  assert.throws(()=>checkPositions([{symbol:'BTCUSDT',size:'not numeric'}],'XRPUSDT'),/Unknown/);
});
test('requires 55 USDT available futures collateral, isolated 10x config and hedge mode',()=>{
  assert.throws(()=>checkAvailableMargin([{asset:'USDT',availableBalance:'50.00'}]),/55/);
  assert.doesNotThrow(()=>checkAvailableMargin([{asset:'USDT',availableBalance:'100'}]));
  assert.throws(()=>verifyAccount({canTrade:true,dualSidePosition:false}),/hedge/);
  assert.doesNotThrow(()=>verifyAccount({canTrade:true,dualSidePosition:true}));
  assert.throws(()=>checkSymbolSettings([{symbol:'XRPUSDT',marginType:'CROSSED',separatedType:'COMBINED'}],'XRPUSDT'),/ISOLATED/);
  assert.equal(checkSymbolSettings([{symbol:'XRPUSDT',marginType:'ISOLATED',separatedType:'COMBINED',isolatedLongLeverage:'10',isolatedShortLeverage:'10'}],'XRPUSDT'),true);
});
test('single MARKET order includes mandatory TP SL and stable deterministic ID',()=>{
  const a=orderPayload(plan);const b=orderPayload(plan);
  assert.deepEqual(a,b);
  assert.equal(a.type,'MARKET');assert.equal(a.side,'BUY');assert.equal(a.positionSide,'LONG');
  assert.equal(a.slTriggerPrice,'1.98');assert.equal(a.tpTriggerPrice,'2.04');
  assert.equal(a.SlWorkingType,'MARK_PRICE');assert.ok(a.newClientOrderId.length<=36);
  assert.equal(clientOrderId(plan),a.newClientOrderId);
  assert.equal(isAccepted({success:true,orderId:'123',clientOrderId:a.newClientOrderId},a.newClientOrderId),true);
  assert.equal(isAccepted({success:false,orderId:'123',clientOrderId:a.newClientOrderId},a.newClientOrderId),false);
  assert.equal(isAccepted({success:true,orderId:'0',clientOrderId:a.newClientOrderId},a.newClientOrderId),false);
  assert.throws(()=>orderPayload({...plan,estimatedLossUsdt:11}),/Unsafe/);
  assert.throws(()=>orderPayload({...plan,stopLoss:2.2}),/Wrong LONG/);
  const short=orderPayload({...plan,direction:'SHORT',stopLoss:2.02,takeProfit:1.96});
  assert.equal(short.side,'SELL');assert.equal(short.positionSide,'SHORT');
});
test('static trading page script parses with modern JavaScript without evaluating secrets',()=>{
  const html=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
  const m=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m,'missing client script');
  assert.doesNotThrow(()=>new Script(m[1],{filename:'trade.html'}));
  assert.doesNotMatch(html,/localStorage\.setItem\([^)]*password/i);
  assert.match(html,/CONFIRM_REAL_WEEX_ORDER/);
});
test('server execution starts with OFF switch and checks live flag before reading approval',async()=>{
  const {default:confirm}=await import('../api/trade-confirm.mjs');
  const prev={...process.env};
  process.env.WEEX_TRADE_APPROVAL_PASSWORD='test-password-with-more-than-20-chars';
  process.env.WEEX_TRADING_ENABLED='false';
  const res={statusCode:0,status(c){this.statusCode=c;return this},setHeader(){return this},json(v){this.body=v;return this}};
  const request={method:'POST',headers:{host:'weex-radar.vercel.app',origin:'https://weex-radar.vercel.app','x-radar-trade-intent':'manual-confirm','content-type':'application/json'},
    body:{password:process.env.WEEX_TRADE_APPROVAL_PASSWORD,confirmation:'CONFIRM_REAL_WEEX_ORDER',proposal:'f'.repeat(64)}};
  await confirm(request,res);
  assert.equal(res.statusCode,403);assert.match(res.body.error,/OFF/);
  Object.assign(process.env,prev);
});
