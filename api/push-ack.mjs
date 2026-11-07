import {createHmac,timingSafeEqual} from 'node:crypto';
function equal(a,b){if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(req.headers.origin&&req.headers.origin!=='https://weex-radar.vercel.app')return res.status(403).json({error:'Origin not allowed'});
 const {id,proof,result}=req.body||{};
 if(!/^[a-f0-9]{32}$/.test(id||'')||!/^[a-f0-9]{64}$/.test(proof||'')||!['shown','show_error'].includes(result))return res.status(400).json({error:'Invalid receipt'});
 const secret=process.env.PUSH_CRON_KEY;
 if(!secret)return res.status(503).json({error:'Receipts unavailable'});
 const expected=createHmac('sha256',secret).update(id).digest('hex');
 if(!equal(proof,expected))return res.status(403).json({error:'Invalid receipt signature'});
 console.info('WEEX_RADAR_PUSH_WORKER '+JSON.stringify({id:id.slice(0,12),result,at:Date.now()}));
 return res.status(200).json({ok:true});
}
