/* WEEX RADAR push service worker: reports when Chrome actually handles push. */
self.addEventListener('push',event=>{
 let msg={};try{msg=event.data?.json()||{}}catch{msg={title:'WEEX RADAR',body:event.data?.text()||''}}
 const title=String(msg.title||'WEEX RADAR');
 const options={body:String(msg.body||''),tag:'weex-radar-'+String(msg.exchange||'')+'-'+String(msg.symbol||'')+'-'+String(msg.candleCloseTime||'')+'-'+String(msg.direction||''),
  icon:'/radar-icon.svg',badge:'/radar-icon.svg',vibrate:[250,125,250],renotify:false,requireInteraction:false,
  data:{url:typeof msg.url==='string'&&/^\/trade\.html\?symbol=[A-Z0-9]{2,20}USDT$/.test(msg.url)?msg.url:'/',expiresAt:msg.expiresAt||0}};
 event.waitUntil((async()=>{
  let result='shown';
  try{await self.registration.showNotification(title,options)}
  catch(e){result='show_error'}
  // The acknowledgement means the service worker called showNotification,
  // NOT that Android showed it on screen or played a sound.
  if(/^[a-f0-9]{32}$/.test(msg.deliveryId||'')&&/^[a-f0-9]{64}$/.test(msg.deliveryProof||'')){
   try{await fetch('/api/push-subscribe',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({receipt:{id:msg.deliveryId,proof:msg.deliveryProof,result}}),cache:'no-store'})}
   catch(e){/* Phone may be offline; failed receipt must not suppress notification. */}
  }
  if(result!=='shown')throw Error('showNotification failed');
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){
   if(client.url.startsWith(self.location.origin)){
    try{if(typeof client.navigate==='function')await client.navigate(target)}catch{}
    await client.focus();
    return;
   }
  }
  await clients.openWindow(target);
 })());
});
