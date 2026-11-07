// POST: explicitly confirmed WEEX Futures market order WITH attached TP/SL.
// Fail-closed on any network ambiguity. One global persistent atomic lock.
import {get,put,del} from '@vercel/blob';
import {_test} from './signals.mjs';
import {weex,configured,validateHumanPassword,requireSameOrigin,liveEnabled,
  verifyAccount,checkPositions,checkOrders,checkSymbolSettings,marketPlan,
  orderPayload,isAccepted,fingerprint} from '../lib/weex-order.mjs';
const LOCK='trading/execution-global.lock';
function isBlobConflict(e){return /already.?exists|conflict|blobalreadyexists|409/i.test(String(e?.message||e));}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function inspectPosition(symbol,direction){
  const all=await weex.positions();
  if(!Array.isArray(all))throw Error('Cannot confirm exchange position');
  const p=all.find(x=>x?.symbol===symbol&&x?.side===direction&&Number(x.size)>0);
  return p||null;
}
async function closeUnprotected(symbol,position){
  if(!position?.id)throw Error('Safety stop: position id unavailable. Manual WEEX intervention required.');
  const close=await weex.closeById(symbol,position.id);
  if(!Array.isArray(close)||!close.some(x=>String(x.positionId)===String(position.id)&&x.success===true))
    throw Error('Safety close was not confirmed; MANUALLY CHECK WEEX NOW.');
  // Check again, because accepted close is not necessarily a filled one.
  for(let i=0;i<3;i++){
    await sleep(400);
    const p=await inspectPosition(symbol,position.side);
    if(!p)return true;
  }
  throw Error('Safety close may still be pending; MANUALLY CHECK WEEX NOW.');
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireSameOrigin(req))return res.status(403).json({error:'Use the official WEEX RADAR website'});
  if(!validateHumanPassword(req.body?.password))return res.status(401).json({error:'Wrong approval password'});
  if(!liveEnabled())return res.status(403).json({error:'Real trading is OFF in Vercel'});
  if(!configured()||!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Trading credentials unavailable'});
  if(req.body?.confirmation!=='CONFIRM_REAL_WEEX_ORDER'||typeof req.body?.proposal!=='string'||
    !/^[a-f0-9]{64}$/.test(req.body.proposal))return res.status(400).json({error:'Invalid explicit confirmation'});
  let proposal;
  try{
    const row=await get('trading/proposals/'+fingerprint(req.body.proposal)+'.json',{access:'private'});
    if(!row)return res.status(409).json({error:'Proposal not found or already expired'});
    proposal=JSON.parse(await new Response(row.stream).text());
    if(!proposal.plan?.symbol||!Number.isFinite(proposal.expiresAt)||Date.now()>proposal.expiresAt-12000)
      return res.status(409).json({error:'Proposal expired. Prepare a new one.'});
  }catch{return res.status(409).json({error:'Unable to read approved proposal'});}
  const plan=proposal.plan;
  if(!_test.SYMBOLS.includes(plan.symbol)||plan.exchange!=='WEEX')
    return res.status(409).json({error:'Unsafe proposal'});
  let locked=false,orderAttempted=false;
  const hash=fingerprint(req.body.proposal);
  let tradeClientId;
  try{
    // This fixed path is a distributed mutex. Never overwrite it.
    try{
      await put(LOCK,JSON.stringify({symbol:plan.symbol,nonce:hash,createdAt:Date.now()}),
        {access:'private',allowOverwrite:false,addRandomSuffix:false,contentType:'application/json'});
      locked=true;
    }catch(e){if(isBlobConflict(e))return res.status(409).json({error:'Another trade is being verified. Check WEEX positions.'});throw e;}
    // Mark this one-time approval as consumed before even considering exchange writes.
    try{
      await put('trading/consumed/'+hash+'.json','1',
        {access:'private',allowOverwrite:false,addRandomSuffix:false});
    }catch(e){if(isBlobConflict(e))return res.status(409).json({error:'This confirmation has already been used'});throw e;}
    const signal=await _test.scanSymbol(plan.symbol);
    if(signal.status!=='ok'||signal.exchange!=='WEEX'||
       signal.direction!==plan.direction||signal.candleCloseTime!==plan.candleCloseTime)
      throw Error('Signal changed. No order was sent.');
    const [account,positions,orders,info,book,settings]=await Promise.all([
      weex.account(),weex.positions(),weex.openOrders(),weex.info(plan.symbol),
      weex.book(plan.symbol),weex.symbolConfig(plan.symbol)
    ]);
    verifyAccount(account);checkPositions(positions,plan.symbol);checkOrders(orders);
    const fresh=marketPlan(signal,info,book);
    if(fresh.quantity!==plan.quantity||fresh.stopLoss!==plan.stopLoss||
       fresh.takeProfit!==plan.takeProfit||
       Math.abs(fresh.entryEstimate/plan.entryEstimate-1)>0.002)
      throw Error('Price or protection changed. Prepare a new proposal.');
    // Configure 10x isolated only after explicit confirmation, and only with no same-symbol position.
    if(!checkSymbolSettings(settings,plan.symbol,true)){
      const original=settings.find(x=>x?.symbol===plan.symbol);
      if(original?.marginType!=='ISOLATED'){
        const r=await weex.marginIsolated(plan.symbol);
        if(r?.code && !['200','00000',200].includes(r.code))throw Error('Cannot select isolated margin');
      }
      const leveraged=await weex.setLeverage(plan.symbol);
      if(leveraged?.marginType!=='ISOLATED'||
        Number(leveraged?.isolatedLongLeverage)!==10||
        Number(leveraged?.isolatedShortLeverage)!==10)throw Error('Cannot set 10x isolated leverage');
      checkSymbolSettings(await weex.symbolConfig(plan.symbol),plan.symbol);
    }
    const order=orderPayload(fresh);
    tradeClientId=order.newClientOrderId;
    // Idempotency is by signal candle + direction; never open the same signal twice.
    const signalHash=fingerprint(tradeClientId);
    try{
      await put('trading/signals/'+signalHash+'.json','1',
        {access:'private',allowOverwrite:false,addRandomSuffix:false});
    }catch(e){if(isBlobConflict(e))throw Error('This market signal was already traded');throw e;}
    orderAttempted=true; // Do not auto-unlock if the network outcome becomes ambiguous.
    const placed=await weex.placeOrder(order);
    if(!isAccepted(placed,tradeClientId))throw Error('WEEX did not confirm the order. Check account manually.');
    const id=String(placed.orderId);
    const detail=await weex.order(id);
    if(String(detail.orderId)!==id ||detail.clientOrderId!==tradeClientId||
       detail.symbol!==plan.symbol||detail.positionSide!==plan.direction)
      throw Error('Order verification failed. CHECK WEEX.');
    let p=null;
    for(let i=0;i<3;i++){
      p=await inspectPosition(plan.symbol,plan.direction);
      if(p)break;
      await sleep(400);
    }
    if(!p)throw Error('Order accepted but position not yet visible. CHECK WEEX.');
    // Attached TP/SL was included in the initial order; the API does not
    // expose guaranteed confirmation in the order response, so never claim it was verified.
    // Fail closed and ask the owner to check protection before unlocking.
    return res.status(202).json({ok:true,status:'PLACED_CHECK_PROTECTION',symbol:plan.symbol,
      direction:plan.direction,orderId:id,clientOrderId:tradeClientId,
      stopLoss:plan.stopLoss,takeProfit:plan.takeProfit,
      message:'Order accepted. Immediately verify TP and SL in WEEX. New orders blocked until safety release.'});
  }catch(e){
    const message=String(e?.message||'Unknown trading error').slice(0,180);
    // If any order was transmitted, DO NOT RELEASE LOCK on ambiguous outcome.
    return res.status(409).json({error:message,requiresManualCheck:orderAttempted});
  }finally{
    if(locked&&!orderAttempted){
      // Do not suppress an unknown outcome if a request to WEEX was made.
      try{await del(LOCK);}catch{}
    }
  }
}
