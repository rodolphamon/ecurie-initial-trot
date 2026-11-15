// Service Worker de l'application Écurie Initial.
// Cache minimal ; aucun contenu privé conservé volontairement en cache.
const CACHE='ei-app-shell-v2';
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','manifest.webmanifest'])));
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
    await self.registration.showNotification(title,{
      body,icon:'/application/icon-ei-192.png',badge:'/application/icon-ei-192.png',
      tag:typeof payload.tag==='string'?payload.tag:undefined,
      data:{url},renotify:false
    });
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
