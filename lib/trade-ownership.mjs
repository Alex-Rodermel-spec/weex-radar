// Account-wide read-only position ownership reconciliation.
// In WEEX combined hedge mode a position is NOT an order: do not infer its
// origin from the symbol alone or from the "radar-" client order prefix.
// Record the actual position identity only after a WEEX-confirmed fill.
// Receipts are private Vercel Blob objects, one per symbol, updated only
// under the existing global execution lock.
import {get} from '@vercel/blob';
import {verifyActiveProtection} from './trade-protection.mjs';

const ID=/^[1-9]\d{0,29}$/;
const SYMBOL=/^[A-Z0-9]{4,24}$/;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
function positionId(p){
 const id=String(p?.id??'');
 if(!ID.test(id))throw Error('Cannot verify WEEX position ID (64-bit identifiers must remain exact)');
 return id;
}
function positionCreation(p){
 const t=Number(p?.createdTime);
 if(!Number.isSafeInteger(t)||t<1_500_000_000_000||t>Date.now()+60_000)
  throw Error('Cannot verify WEEX position creation time');
 return t;
}
function validateReceipt(r,symbol){
 if(!r||r.version!==1||r.symbol!==symbol||!SYMBOL.test(symbol)||
   !['LONG','SHORT'].includes(r.direction)||!ID.test(r.positionId)||
   !Number.isSafeInteger(r.positionCreatedAt)||!ID.test(r.openingOrderId)||
   typeof r.clientOrderId!=='string'||!/^radar-[a-f0-9]{25}$/.test(r.clientOrderId)||
   !positive(r.recordedSize)||!positive(r.stopLoss)||!positive(r.takeProfit)||
   !Number.isSafeInteger(r.recordedAt))throw Error('Invalid private RADAR position ownership receipt');
 return r;
}
export function ownershipPath(symbol){
 if(!SYMBOL.test(symbol))throw Error('Invalid WEEX position symbol');
 return 'trading/owned-position-v1/'+symbol+'.json';
}
export function normalizeActivePositions(positions){
 if(!Array.isArray(positions))throw Error('Cannot verify WEEX positions');
 const active=[];
 for(const p of positions){
  if(!p||typeof p.symbol!=='string'||!SYMBOL.test(p.symbol)||
    !finite(Number(p.size))||Number(p.size)<0)
   throw Error('Invalid WEEX position data');
  if(Number(p.size)===0)continue;
  positionId(p);positionCreation(p);
  if(!['LONG','SHORT'].includes(p.side))throw Error('Unknown WEEX position direction');
  active.push(p);
 }
 return active;
}
export function classifyPositions(positions,receipts=new Map()){
 const active=normalizeActivePositions(positions);
 if(!(receipts instanceof Map))throw Error('Missing verified ownership records');
 const bot=[],manual=[];
 for(const p of active){
  const r=receipts.get(p.symbol);
  if(r===undefined||r===null){manual.push(p);continue}
  const receipt=validateReceipt(r,p.symbol);
  const id=positionId(p),created=positionCreation(p);
  if(id===receipt.positionId&&created!==receipt.positionCreatedAt)
   throw Error('Ambiguous recycled WEEX position ID; manual verification required');
  if(id!==receipt.positionId||created!==receipt.positionCreatedAt){
   // The original bot position has closed. A newer distinct position on
   // this symbol may be a manual one. Never count solely by symbol.
   manual.push(p);
   continue;
  }
  if(p.side!==receipt.direction||p.marginType!=='ISOLATED'||
    Number(p.leverage)!==10||Number(p.size)>Number(receipt.recordedSize)*1.000001)
   throw Error('RADAR position changed manually; block additional bot trades');
  bot.push({position:p,receipt});
 }
 if(bot.length>2)throw Error('More than two bot-owned positions; manual review required');
 return {active,bot,manual,botOpenPositions:bot.length,
  manualOpenPositions:manual.length,totalOpenPositions:active.length};
}
export async function readOwnedPortfolio(positions,read=get){
 const active=normalizeActivePositions(positions);
 const symbols=[...new Set(active.map(p=>p.symbol))];
 const records=await Promise.all(symbols.map(async symbol=>{
  const data=await read(ownershipPath(symbol),{access:'private'});
  if(!data)return [symbol,null];
  const raw=await new Response(data.stream).text();
  if(raw.length>4000)throw Error('Private RADAR ownership receipt too large');
  return [symbol,validateReceipt(JSON.parse(raw),symbol)];
 }));
 return classifyPositions(positions,new Map(records));
}
export async function verifyOtherBotProtection(portfolio,loadAlgo){
 if(!portfolio||!Array.isArray(portfolio.bot)||typeof loadAlgo!=='function')
  throw Error('Cannot verify existing RADAR positions');
 for(const {position:p,receipt:r} of portfolio.bot){
  const active=await loadAlgo(p.symbol);
  const safe=verifyActiveProtection(active,{
    symbol:r.symbol,direction:r.direction,stopLoss:r.stopLoss,takeProfit:r.takeProfit
  },p);
  if(!safe.verified)throw Error('Existing RADAR '+r.symbol+' position lacks verified TP and SL');
 }
 return true;
}
export function ownershipReceipt({position:p,order,detail,plan,sentAt,now=Date.now()}){
 if(!plan||!['LONG','SHORT'].includes(plan.direction)||!SYMBOL.test(plan.symbol)||
   order?.symbol!==plan.symbol||order.positionSide!==plan.direction||
   detail?.symbol!==plan.symbol||detail.positionSide!==plan.direction||
   detail.clientOrderId!==order.newClientOrderId||
   String(detail.orderId)!==String(order.orderId??detail.orderId)||
   detail.status!=='FILLED'||!positive(detail.executedQty))
   throw Error('WEEX order fill not verified; cannot record ownership');
 const id=positionId(p),created=positionCreation(p);
 if(p.symbol!==plan.symbol||p.side!==plan.direction||
   p.marginType!=='ISOLATED'||Number(p.leverage)!==10||
   !Number.isSafeInteger(sentAt)||created<sentAt-60_000||
   created>now+5000||!positive(p.size)||
   Number(p.size)>Number(detail.executedQty)*1.000001||
   !positive(plan.stopLoss)||!positive(plan.takeProfit))
   throw Error('New WEEX position identity or executed quantity cannot be verified');
 const record={
  version:1,symbol:plan.symbol,direction:plan.direction,
  positionId:id,positionCreatedAt:created,
  openingOrderId:String(detail.orderId),clientOrderId:order.newClientOrderId,
  recordedSize:String(p.size),stopLoss:plan.stopLoss,takeProfit:plan.takeProfit,
  recordedAt:now
 };
 return validateReceipt(record,plan.symbol);
}
