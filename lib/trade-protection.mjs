// Strict read-only validation. Do not consider an unverified stop as protected.
export function verifyActiveProtection(orders, plan, position) {
 const {symbol,direction,stopLoss,takeProfit}=plan||{};
 if(!Array.isArray(orders)||!symbol||!['LONG','SHORT'].includes(direction))return {verified:false,stop:false,take:false};
 const qty=Number(position?.size);
 if(!(qty>0))return {verified:false,stop:false,take:false};
 const exitSide=direction==='LONG'?'SELL':'BUY';
 const eligible=orders.filter(o=>
   o?.symbol===symbol&&o?.positionSide===direction&&o?.side===exitSide&&
   ['NEW','PENDING','UNTRIGGERED'].includes(o?.algoStatus)&&
   (o?.reduceOnly===true||o?.closePosition===true)&&
   (o.closePosition===true||(Number(o.quantity)>0&&Number(o.quantity)>=qty-1e-12)));
 const match=(type,price)=>eligible.some(o=>o?.orderType===type&&
   Number(o.triggerPrice)>0&&Number(price)>0&&
   Math.abs(Number(o.triggerPrice)-Number(price))<=Math.max(1e-10,Number(price)*1e-9));
 const stop=match('STOP_MARKET',stopLoss);
 const take=match('TAKE_PROFIT_MARKET',takeProfit);
 return {verified:stop&&take,stop,take};
}
