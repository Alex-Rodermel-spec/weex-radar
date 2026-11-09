import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {createHmac} from 'node:crypto';
import {
  safeEqual,signedHeaders,validateHumanPassword,liveEnabled,requireSameOrigin,
  checkPositions,checkAvailableMargin,checkOrders,checkSymbolSettings,
  orderPayload,isAccepted,clientOrderId,verifyAccount,parseExchangeResponse
} from '../lib/weex-order.mjs';
const creds={key:'example_public',secret:'fake_test_secret',passphrase:'fake_test_passphrase'};
const plan={symbol:'XRPUSDT',exchange:'WEEX',direction:'LONG',marginUsdt:50,leverage:10,
  estimatedLossUsdt:5,estimatedNetLossUsdt:6.7,estimatedNetProfitUsdt:12.9,
  estimatedNetRR:1.92,costGate:'PASS_ESTIMATE',
  stopLoss:1.98,takeProfit:2.06,entryEstimate:2,quantity:'250',candleCloseTime:1794027000000};
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
test('two bot-owned slots; manual positions on other coins excluded, same coin blocked',()=>{
  const p=(symbol)=>({symbol,size:'0.5'});
  const owned=(active,botCount)=>({active,bot:active.slice(0,botCount),manual:active.slice(botCount)});
  assert.equal(checkPositions([],'XRPUSDT',owned([],0)),0);
  const manual=[p('BTCUSDT'),p('ETHUSDT')];
  assert.equal(checkPositions(manual,'XRPUSDT',owned(manual,0)),0);
  assert.equal(checkPositions(manual,'XRPUSDT',owned(manual,1)),1);
  assert.throws(()=>checkPositions(manual,'XRPUSDT',owned(manual,2)),/maximum 2/i);
  assert.throws(()=>checkPositions([p('XRPUSDT')],'XRPUSDT',owned([p('XRPUSDT')],0)),/already/);
  assert.throws(()=>checkPositions(manual,'XRPUSDT'),/ownership/);
  assert.throws(()=>checkOrders([{symbol:'BTCUSDT',reduceOnly:false}]),/Pending/);
  assert.doesNotThrow(()=>checkOrders([{symbol:'BTCUSDT',reduceOnly:true}]));
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
  assert.equal(a.slTriggerPrice,'1.98');assert.equal(a.tpTriggerPrice,'2.06');
  assert.equal(a.SlWorkingType,'MARK_PRICE');assert.ok(a.newClientOrderId.length<=36);
  assert.equal(clientOrderId(plan),a.newClientOrderId);
  assert.equal(isAccepted({success:true,orderId:'123',clientOrderId:a.newClientOrderId},a.newClientOrderId),true);
  assert.equal(isAccepted({success:false,orderId:'123',clientOrderId:a.newClientOrderId},a.newClientOrderId),false);
  assert.equal(isAccepted({success:true,orderId:'0',clientOrderId:a.newClientOrderId},a.newClientOrderId),false);
  assert.throws(()=>orderPayload({...plan,estimatedLossUsdt:11}),/Unsafe/);
  assert.throws(()=>orderPayload({...plan,costGate:null}),/Unsafe/);
  assert.throws(()=>orderPayload({...plan,estimatedNetLossUsdt:10.01}),/Unsafe/);
  assert.throws(()=>orderPayload({...plan,estimatedNetProfitUsdt:0}),/Unsafe/);
  assert.throws(()=>orderPayload({...plan,estimatedNetRR:1.49}),/Unsafe/);
  assert.throws(()=>orderPayload({...plan,estimatedNetLossUsdt:4.99}),/Unsafe/);
  assert.throws(()=>orderPayload({...plan,stopLoss:2.2}),/Wrong LONG/);
  const short=orderPayload({...plan,direction:'SHORT',stopLoss:2.02,takeProfit:1.94});
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

test('preserves exact WEEX 64-bit position IDs for ownership receipts',()=>{
 const raw='[{"id":689987235755328123,"symbol":"BTCUSDT","side":"LONG","size":"0.02","createdTime":1764505776347}]';
 const parsed=parseExchangeResponse(raw,'/capi/v3/account/position/allPosition');
 assert.equal(parsed[0].id,'689987235755328123');
 assert.equal(parseExchangeResponse('[{"id":"689987235755328123"}]',
  '/capi/v3/account/position/allPosition')[0].id,'689987235755328123');
});
test('preserves WEEX 64-bit order IDs exactly from exchange JSON',()=>{
  const id='702345678901234567';
  const parsed=parseExchangeResponse('{"orderId":'+id+',"success":true,"clientOrderId":"radar-abc"}','/capi/v3/order');
  assert.equal(parsed.orderId,id);
  assert.equal(isAccepted(parsed,'radar-abc'),true);
  const detail=parseExchangeResponse('{"orderId":"'+id+'","symbol":"XRPUSDT"}','/capi/v3/order');
  assert.equal(detail.orderId,id);
});

test('connection errors display next to connection button, not under coin selection',()=>{
  const html=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
  assert.match(html, /account\.textContent='❌ Проверка WEEX не прошла/);
  assert.match(html, /\$\('status'\)\.onclick=/);
  assert.match(html, /e\.key==='Enter'/);
});

test('WEEX diagnostics return safe numeric codes only',async()=>{
 const {describeConnectionFailure}=await import('../api/trade-status.mjs');
 assert.equal(describeConnectionFailure(new Error('WEEX_CODE_-1049')).code,'-1049');
 assert.match(describeConnectionFailure(new Error('WEEX_CODE_-1056')).message,/IP-адрес/);
 assert.equal(describeConnectionFailure(new Error('secret: confidential')).code,null);
 assert.doesNotMatch(describeConnectionFailure(new Error('secret: confidential')).message,/confidential/);
});

test('OIDC auth probe rejects untrusted callers and strips upstream errors',async()=>{
 const {validProbeToken,safeProbeError}=await import('../api/weex-auth-probe.mjs');
 assert.equal(await validProbeToken(''),false);
 assert.equal(await validProbeToken('a'.repeat(8500)),false);
 const example={repository:'Alex-Rodermel-spec/weex-radar',ref:'refs/heads/main',
  event_name:'push',workflow_ref:'Alex-Rodermel-spec/weex-radar/.github/workflows/weex-auth-probe.yml@refs/heads/main'};
 const mock=async()=>({payload:example});
 assert.equal(await validProbeToken('sample',mock),true);
 assert.equal(await validProbeToken('sample',async()=>({payload:{...example,ref:'refs/heads/hack'}})),false);
 assert.deepEqual(safeProbeError(new Error('WEEX_CODE_40009')),{stage:'api',code:'40009'});
 assert.deepEqual(safeProbeError(new Error('SECRET-DO-NOT-EXPOSE')),{stage:'network_or_response',code:null});
});

test('WEEX headers ignore accidental paste whitespace around credentials',()=>{
 const plain={key:'test-key',secret:'test-secret',passphrase:'test-phrase'};
 const padded={key:' test-key\n',secret:'  test-secret\n',passphrase:'test-phrase \r\n'};
 const h1=signedHeaders('GET','/capi/v3/account/accountConfig','','',1794049000000,plain);
 const h2=signedHeaders('GET','/capi/v3/account/accountConfig','','',1794049000000,padded);
 assert.deepEqual(h1,h2);
});

test('read-only probe checks account, balance, and positions without reporting money',()=>{
 const code=readFileSync(new URL('../api/weex-auth-probe.mjs',import.meta.url),'utf8');
 assert.match(code,/Promise\.allSettled\(\[weex\.account\(\),weex\.balance\(\),weex\.positions\(\)\]\)/);
 assert.match(code,/market\/time/);
 assert.match(code,/ordersSent:0/);
 assert.doesNotMatch(code,/weex\.placeOrder\(/);
});

test('WEEX readiness probe is strictly read-only and same-origin protected',()=>{
 const code=readFileSync(new URL('../api/trade-preflight.mjs',import.meta.url),'utf8');
 assert.match(code,/validateHumanPassword/);
 assert.match(code,/requireSameOrigin/);
 assert.match(code,/weex\.apiTradingSymbols\(\)/);
 assert.doesNotMatch(code,/weex\.(placeOrder|setLeverage|marginIsolated|closeById)\(/);
});

test('OIDC probe inspects trading prerequisites using read-only WEEX calls only',()=>{
 const code=readFileSync(new URL('../api/weex-auth-probe.mjs',import.meta.url),'utf8');
 for(const method of ['openOrders','symbolConfig','info','book','apiTradingSymbols'])
   assert.ok(code.includes('weex.'+method+'('),method+' read check is missing');
 for(const method of ['placeOrder','setLeverage','marginIsolated','closeById'])
   assert.ok(!code.includes('weex.'+method+'('),method+' should never run in probe');
});

test('order prepare and confirm require listing in WEEX Futures API trading symbols',()=>{
 for(const file of ['trade-prepare.mjs','trade-confirm.mjs']){
  const code=readFileSync(new URL('../api/'+file,import.meta.url),'utf8');
  assert.match(code,/weex\.apiTradingSymbols\(\)/);
  assert.match(code,/apiTradingSymbols\.includes\(/);
 }
});
test('OIDC dry-run exercises pure market plan and order payload without a real order',()=>{
 const code=readFileSync(new URL('../api/weex-auth-probe.mjs',import.meta.url),'utf8');
 assert.match(code,/marketPlan\(synthetic/);
 assert.match(code,/orderPayload\(plan\)/);
 assert.doesNotMatch(code,/weex\.placeOrder\(/);
});

test('execution release requires exchange evidence of both TP/SL orders',()=>{
 const code=readFileSync(new URL('../api/trade-release.mjs',import.meta.url),'utf8');
 assert.match(code,/weex\.openAlgoOrders\(lock\.symbol\)/);
 assert.match(code,/verifyActiveProtection\(algoOrders,lock,same\[0\]\)/);
 assert.match(code,/if\(!protection\.verified\)/);
 const confirm=readFileSync(new URL('../api/trade-confirm.mjs',import.meta.url),'utf8');
 assert.match(confirm,/stopLoss:plan\.stopLoss,takeProfit:plan\.takeProfit/);
});

test('OIDC read-only verification also checks protective order visibility',()=>{
 const code=readFileSync(new URL('../api/weex-auth-probe.mjs',import.meta.url),'utf8');
 assert.match(code,/weex\.openAlgoOrders\('XRPUSDT'\)/);
 assert.match(code,/check\.openAlgoOrders=summarize/);
 assert.doesNotMatch(code,/weex\.placeOrder\(/);
});
