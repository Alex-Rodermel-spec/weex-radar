/* WEEX RADAR push service worker: reports when Chrome actually handles push. */
// Activate new early-watch notification support without closing old browser tabs.
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting())});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});
self.addEventListener('push',event=>{
 let msg={};try{msg=event.data?.json()||{}}catch{msg={title:'WEEX RADAR',body:event.data?.text()||''}}
 const title=String(msg.title||'WEEX RADAR');
 const isLateConfirmedSignal=msg.kind==='signal'&&(
   (Number.isFinite(Number(msg.sentAt))&&Number(msg.sentAt)>0&&Date.now()-Number(msg.sentAt)>=45000)||
   (Number.isFinite(Number(msg.candleCloseTime))&&Number(msg.candleCloseTime)>0&&Date.now()-Number(msg.candleCloseTime)>=90000));
 const visibleTitle=isLateConfirmedSignal?'⚠️ ПОЗДНИЙ СИГНАЛ · '+title:title;
 const isEarly=msg.kind==='early_watch';
 const isSignal=msg.kind==='signal'||msg.kind==='signal_test'||isEarly;
 const options={body:(isLateConfirmedSignal?'⚠️ Проверь актуальную цену перед входом. ':'')+String(msg.body||''),tag:'weex-radar-'+String(msg.kind||'')+'-'+String(msg.exchange||'')+'-'+String(msg.symbol||'')+'-'+String(msg.candleCloseTime||'')+'-'+String(msg.direction||''),
  icon:'/radar-icon.svg',badge:'/radar-icon.svg',vibrate:[350,150,350],renotify:isSignal&&!isEarly,requireInteraction:isSignal&&!isEarly,
  data:{url:typeof msg.url==='string'&&(
    /^\/trade\.html\?symbol=[A-Z0-9]{2,20}USDT$/.test(msg.url)||
    /^\/tradingview\.html\?symbol=[A-Z0-9]{2,20}USDT&interval=1$/.test(msg.url)
   )?msg.url:'/',expiresAt:msg.expiresAt||0}};
 event.waitUntil((async()=>{
  let result='shown';
  const expiration=Number(msg.expiresAt);
  // Do not display trading signals that were delayed beyond their expiry.
  if(isSignal&&Number.isFinite(expiration)&&expiration>0&&Date.now()>=expiration)result='expired';
  else {
   try{await self.registration.showNotification(visibleTitle,options)}
   catch(e){result='show_error'}
  }
  // The acknowledgement means the service worker called showNotification,
  // NOT that Android showed it on screen or played a sound.
  if(/^[a-f0-9]{32}$/.test(msg.deliveryId||'')&&/^[a-f0-9]{64}$/.test(msg.deliveryProof||'')&&
     /^[a-f0-9]{64}$/.test(msg.subscriberId||'')&&['signal','test','background_test','signal_test','early_watch'].includes(msg.kind)){
   try{await fetch('/api/push-subscribe',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({receipt:{id:msg.deliveryId,proof:msg.deliveryProof,subscriberId:msg.subscriberId,kind:msg.kind,result}}),cache:'no-store'})}
   catch(e){/* Phone may be offline; failed receipt must not suppress notification. */}
  }
  if(result==='show_error')throw Error('showNotification failed');
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
