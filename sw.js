/* WEEX RADAR push service worker */
self.addEventListener('push',event=>{
 let msg={};try{msg=event.data?.json()||{}}catch{msg={title:'WEEX RADAR',body:event.data?.text()||''}}
 const title=String(msg.title||'WEEX RADAR');
 const options={body:String(msg.body||''),tag:'weex-radar-'+String(msg.exchange||'')+'-'+String(msg.symbol||'')+'-'+String(msg.candleCloseTime||'')+'-'+String(msg.direction||''),
  icon:'/radar-icon.svg',badge:'/radar-icon.svg',vibrate:[250,125,250],renotify:false,requireInteraction:false,
  data:{url:'/',expiresAt:msg.expiresAt||0}};
 event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(client.url.startsWith(self.location.origin)){await client.focus();return}}
  await clients.openWindow('/');
 })());
});
