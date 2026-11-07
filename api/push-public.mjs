export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 return res.status(200).json({enabled:Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.BLOB_READ_WRITE_TOKEN),publicKey:process.env.VAPID_PUBLIC_KEY||null});
}
