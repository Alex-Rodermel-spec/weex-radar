// Public read-only status for the owner. Contains simulated data only.
// No WEEX private-account details, tokens, order IDs or balance.
import {paperTradingStatus} from '../lib/paper-trading-store.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{return res.status(200).json(await paperTradingStatus())}
 catch{return res.status(503).json({ok:false,mode:'PAPER_ONLY',
  realOrders:false,error:'Simulated journal temporarily unavailable'});}
}
