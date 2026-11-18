// Service Worker de l'application Écurie Initial.
// Cache minimal ; aucun contenu privé conservé volontairement en cache.
const CACHE='ei-app-shell-v14';
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','manifest.webmanifest','icon-ei-192.png','notification-ei-badge.png','notification-transparent-192.png'])));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const k of await caches.keys())if(k.startsWith('ei-app-')&&k!==CACHE)await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  // Pas de cache des comptes privés, des requêtes Supabase ou des paramètres.
  const url=new URL(event.request.url);
  if(url.pathname.includes('/application/connexion/')||url.pathname.includes('/application/administration/')||
     url.pathname.includes('/application/mes-chevaux/')||url.pathname.includes('/application/tribune/')||
     url.pathname.includes('/application/notifications/'))return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
// Diagnostic limité à ce navigateur : horodatage et résultat d'affichage seulement.
function recordPushStatus(status,error,details){
  return new Promise(resolve=>{
    try{
      const open=indexedDB.open('ei-push-debug-v1',1);
      open.onupgradeneeded=()=>{
        if(!open.result.objectStoreNames.contains('events'))open.result.createObjectStore('events');
      };
      open.onerror=()=>resolve();
      open.onsuccess=()=>{
        const db=open.result;
        const tx=db.transaction('events','readwrite');
        const entry={at:new Date().toISOString(),status,error:error||null,...(details||{})};
        const store=tx.objectStore('events');
        store.put(entry,'last');
        if(status==='received')store.put(entry,'last_received');
        if(status==='shown'||status==='error')store.put(entry,'last_display');
        if(status==='click-opened'||status==='click-failed')store.put(entry,'last_click');
        tx.oncomplete=()=>{db.close();resolve()};
        tx.onerror=()=>{db.close();resolve()};
        tx.onabort=()=>{db.close();resolve()};
      };
    }catch(_){resolve()}
  });
}
// Accusés de réception facultatifs : un serveur indisponible ne doit jamais
// empêcher l'affichage d'une notification.
async function reportPushReceipt(id,status,at,error){
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return;
 try{
  await fetch('https://yeecwaaizmvrhwobukfa.supabase.co/functions/v1/push-receipt',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id,status,at,error:error||null}),
   cache:'no-store'
  });
 }catch(_){/* Échec télémétrie sans impact utilisateur. */}
}
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let payload={};
    try{payload=event.data?event.data.json():{}}catch{payload={}}
    const title=typeof payload.title==='string'?payload.title:'Écurie Initial';
    const body=typeof payload.body==='string'?payload.body:'Une nouvelle information est disponible.';
    let url='/application/';
    try{
      const target=new URL(payload.url||url,self.location.origin);
      if(target.origin===self.location.origin)url=target.href;
    }catch{}
    const receiptId=typeof payload.receipt_id==='string'?payload.receipt_id:null;
    const receivedAt=new Date().toISOString();
    const reportReceived=reportPushReceipt(receiptId,'received',receivedAt);
    await recordPushStatus('received',null);
    try{
      await self.registration.showNotification(title,{
        body,
        icon:'/application/notification-transparent-192.png', // L'icône système officielle reste à gauche, pas de second logo à droite.
        badge:'/application/notification-ei-badge.png',
        tag:typeof payload.tag==='string'?payload.tag:undefined,
        data:{url},renotify:false
      });
      const shownAt=new Date().toISOString();
      await Promise.allSettled([recordPushStatus('shown',null),
        reportReceived,reportPushReceipt(receiptId,'shown',shownAt)]);
    }catch(e){
      const reason=e instanceof Error?e.name:'erreur d’affichage';
      await Promise.allSettled([recordPushStatus('error',reason),
        reportReceived,reportPushReceipt(receiptId,'error',new Date().toISOString(),reason)]);
    }
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    // Conserver le chemin, le ?info=... et l'ancre #nouvelles-privees.
    // Refuser les domaines extérieurs, pour qu'une notification ne puisse
    // jamais rediriger vers un site arbitraire.
    const fallback=new URL('/application/',self.location.origin);
    let target=fallback;
    try{
      const candidate=new URL(event.notification.data?.url||fallback.href,self.location.origin);
      if(candidate.origin===self.location.origin&&/^https?:$/.test(candidate.protocol))target=candidate;
    }catch(_){}
    const route=target.pathname+target.search+target.hash;
    let lastError='Aucune fenêtre disponible';
    let windows=[];
    try{windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});}
    catch(error){lastError=String(error?.message||error);}
    const sameOrigin=windows.filter(client=>{
      try{return new URL(client.url).origin===self.location.origin}catch(_){return false}
    });
    // Préférer une fenêtre de l'application, pas un onglet quelconque du site.
    const candidates=[
      ...sameOrigin.filter(client=>client.url.startsWith(self.location.origin+'/application/')),
      ...sameOrigin.filter(client=>!client.url.startsWith(self.location.origin+'/application/'))
    ];
    for(const client of candidates){
      try{
        if(client.url===target.href){
          await client.focus();
          await recordPushStatus('click-opened',null,{route,method:'focus'});
          return;
        }
        if(typeof client.navigate==='function'){
          const navigated=await client.navigate(target.href);
          if(navigated){
            await navigated.focus();
            await recordPushStatus('click-opened',null,{route,method:'navigate'});
            return;
          }
          lastError='Navigation refusée par le navigateur';
        }
      }catch(error){lastError=String(error?.message||error)}
    }
    // Repli indispensable sur iOS et si navigate() échoue dans une PWA.
    try{
      const opened=await self.clients.openWindow(target.href);
      if(opened){
        await opened.focus();
        await recordPushStatus('click-opened',null,{route,method:'openWindow'});
        return;
      }
      lastError='Ouverture refusée par le téléphone';
    }catch(error){lastError=String(error?.message||error)}
    await recordPushStatus('click-failed',lastError,{route,method:'none'});
  })());
});
