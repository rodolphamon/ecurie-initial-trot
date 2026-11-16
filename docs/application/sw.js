// Service Worker de l'application Écurie Initial.
// Cache minimal ; aucun contenu privé conservé volontairement en cache.
const CACHE='ei-app-shell-v7';
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','manifest.webmanifest','notification-ei-orange.png','notification-ei-badge.png'])));
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
function recordPushStatus(status,error){
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
        tx.objectStore('events').put({at:new Date().toISOString(),status,error:error||null},'last');
        tx.oncomplete=()=>{db.close();resolve()};
        tx.onerror=()=>{db.close();resolve()};
        tx.onabort=()=>{db.close();resolve()};
      };
    }catch(_){resolve()}
  });
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
    try{
      await self.registration.showNotification(title,{
        body,
        icon:'/application/notification-ei-orange.png',
        badge:'/application/notification-ei-badge.png',
        tag:typeof payload.tag==='string'?payload.tag:undefined,
        data:{url},renotify:false
      });
      await recordPushStatus('shown',null);
    }catch(e){
      await recordPushStatus('error',e instanceof Error?e.name:'erreur d’affichage');
    }
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    let url='/application/';
    try{const target=new URL(event.notification.data?.url||url,self.location.origin);if(target.origin===self.location.origin)url=target.href}catch{}
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(new URL(client.url).origin===self.location.origin){
        if('navigate' in client)await client.navigate(url);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
