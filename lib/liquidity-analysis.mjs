// Pure indicative WEEX USDT-M futures order-book snapshot math.
// READ-ONLY. No exchange keys, account access, order creation or auto signals.
// WEEX V3 'size' units are not explicit in depth docs; simulation assumes
// base-asset quantity and MUST be labelled as indicative, never an execution quote.
const MAX_LEVELS=200;
export const DEFAULT_NOTIONAL_USDT=2500;

function positive(x){return Number.isFinite(x)&&x>0}
function round(x,places=2){return Number.isFinite(x)?Math.round(x*10**places)/10**places:null}
function readSide(rows,descending){
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_LEVELS)throw Error('Некорректный стакан WEEX');
 const levels=[];
 for(const item of rows){
  if(!Array.isArray(item)||item.length<2)throw Error('Некорректный уровень стакана');
  const price=Number(item[0]),size=Number(item[1]);
  if(!positive(price)||!positive(size))throw Error('Некорректная цена или размер уровня');
  levels.push({price,size});
 }
 levels.sort((a,b)=>descending?b.price-a.price:a.price-b.price);
 const merged=[];
 for(const level of levels){
  if(merged.length&&merged.at(-1).price===level.price)merged.at(-1).size+=level.size;
  else merged.push({...level});
 }
 return merged;
}

export function normalizeBook(data){
 if(!data||typeof data!=='object')throw Error('Нет стакана WEEX');
 const body=Array.isArray(data.bids)&&Array.isArray(data.asks)?data:data.data;
 if(!body||!Array.isArray(body.bids)||!Array.isArray(body.asks))
  throw Error('Неожиданный формат стакана WEEX');
 const bids=readSide(body.bids,true),asks=readSide(body.asks,false);
 const bestBid=bids[0].price,bestAsk=asks[0].price;
 if(bestBid>=bestAsk)throw Error('Стакан пересёкся или устарел');
 const mid=(bestBid+bestAsk)/2;
 if(!positive(mid))throw Error('Некорректная средняя цена');
 return {bids,asks,bestBid,bestAsk,mid};
}

function nearDepth(side,mid,percent,direction){
 const boundary=direction==='LONG'?mid*(1+percent/100):mid*(1-percent/100);
 const depth=side.reduce((sum,{price,size})=>
  sum+((direction==='LONG'?price<=boundary:price>=boundary)?price*size:0),0);
 return round(depth,0);
}

// Simulate equal BASE units: qty = requested USDT notional / mid.
// Return *null* impact when 200 levels cannot fill that modeled quantity.
export function simulateNotional(side,mid,notionalUSDT,dir){
 if(!Array.isArray(side)||!positive(mid)||!positive(notionalUSDT)||
   !['LONG','SHORT'].includes(dir))throw Error('Некорректные параметры симуляции');
 let remaining=notionalUSDT/mid,baseFilled=0,quoteTotal=0,levelsUsed=0;
 for(const {price,size} of side){
  if(!positive(price)||!positive(size))throw Error('Некорректный уровень стакана');
  const taking=Math.min(size,remaining);
  if(taking<=0)continue;
  remaining-=taking;baseFilled+=taking;quoteTotal+=taking*price;levelsUsed++;
  if(remaining<=notionalUSDT/mid*1e-9){remaining=0;break}
 }
 const fullFill=remaining===0;
 const averagePrice=fullFill?quoteTotal/baseFilled:null;
 const best=side[0]?.price;
 const impactBps=fullFill?
  (dir==='LONG'?(averagePrice-best)/best:(best-averagePrice)/best)*10000:null;
 return {fullFill,averagePrice:round(averagePrice,8),
  impactBps:fullFill?round(Math.max(0,impactBps)):null,
  levelsUsed,coveredPct:round(baseFilled/(notionalUSDT/mid)*100,1),
  unfilledPct:round(remaining/(notionalUSDT/mid)*100,1)};
}

export function summarizeLiquidity(raw,notionalUSDT=DEFAULT_NOTIONAL_USDT){
 if(!positive(notionalUSDT)||notionalUSDT<100||notionalUSDT>10000)
  throw Error('Объём наблюдения должен быть от 100 до 10 000 USDT');
 const book=normalizeBook(raw),{bids,asks,bestBid,bestAsk,mid}=book;
 const spreadBps=10000*(bestAsk-bestBid)/mid;
 const long=simulateNotional(asks,mid,notionalUSDT,'LONG');
 const short=simulateNotional(bids,mid,notionalUSDT,'SHORT');
 const spreadLabel=spreadBps<=10?'Узкий':spreadBps<=30?'Средний':'Широкий';
 const assessment=(outcome)=>{
  if(!outcome.fullFill)return 'Видимой глубины недостаточно';
  if(spreadBps>30||outcome.impactBps>30)return 'Высокие наблюдаемые издержки';
  if(spreadBps>10||outcome.impactBps>10)return 'Умеренные наблюдаемые издержки';
  return 'Низкие наблюдаемые издержки';
 };
 return {
  source:'WEEX futures V3 public depth',depthLimit:MAX_LEVELS,
  bestBid,bestAsk,mid:round(mid,8),spreadBps:round(spreadBps),
  spreadPct:round(spreadBps/100,4),spreadLabel,
  notionalUSDT,nearDepthUSDT:{
   bid025:nearDepth(bids,mid,0.25,'SHORT'),ask025:nearDepth(asks,mid,0.25,'LONG'),
   bid050:nearDepth(bids,mid,0.5,'SHORT'),ask050:nearDepth(asks,mid,0.5,'LONG')
  },
  long:{...long,assessment:assessment(long)},
  short:{...short,assessment:assessment(short)},
  assumptions:{
   model:'Assumes depth size represents base asset units; confirm WEEX contract denomination before interpreting slippage estimates.',
   noTimestamp:'REST depth response does not document a snapshot timestamp; fetchedAt marks local HTTP response time only.',
   noExecution:'No market order placed. Fees, funding, latency, book replenishment and actual execution not simulated.'
  }
 };
}
