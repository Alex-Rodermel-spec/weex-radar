// Read-only WEEX depth observation. Reuses /api/signals?mode=liquidity to
// avoid an extra Vercel Hobby serverless function. No live orders or secrets.
import {summarizeLiquidity,DEFAULT_NOTIONAL_USDT} from './liquidity-analysis.mjs';

export async function handleLiquidity(req,res,symbols){
 res.setHeader('Cache-Control','no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const params=new URL(req.url||'/','https://weex-radar.vercel.app').searchParams;
 const symbol=typeof req.query?.symbol==='string'?req.query.symbol:params.get('symbol');
 if(!Array.isArray(symbols)||!symbols.includes(symbol))
  return res.status(400).json({error:'Неподдерживаемая пара WEEX'});
 const rawSize=typeof req.query?.notional==='string'?req.query.notional:params.get('notional');
 const notionalUSDT=rawSize===null||rawSize===undefined?DEFAULT_NOTIONAL_USDT:Number(rawSize);
 if(!Number.isFinite(notionalUSDT)||notionalUSDT<100||notionalUSDT>10000)
  return res.status(400).json({error:'Объём наблюдения от 100 до 10000 USDT'});
 const url='https://api-contract.weex.com/capi/v3/market/depth?symbol='+
  encodeURIComponent(symbol)+'&limit=200';
 try{
  const response=await fetch(url,{
   signal:AbortSignal.timeout(6500),cache:'no-store',
   headers:{Accept:'application/json','User-Agent':'WEEX-RADAR/1.0'}
  });
  if(!response.ok)throw Error('HTTP '+response.status);
  const raw=await response.json();
  const result=summarizeLiquidity(raw,notionalUSDT);
  return res.status(200).json({
   symbol,exchange:'WEEX',fetchedAt:Date.now(),
   ...result,mode:'observation-only',
   alertsUnchanged:true,ordersEnabled:false
  });
 }catch(e){
  console.warn('WEEX_RADAR_LIQUIDITY_UNAVAILABLE '+String(e.message||e).slice(0,80));
  return res.status(503).json({
   symbol,exchange:'WEEX',status:'unavailable',
   reason:'Нет надёжного снимка стакана WEEX. Цифры не показываем.',
   alertsUnchanged:true,ordersEnabled:false
  });
 }
}
